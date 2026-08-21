#!/usr/bin/env node
/**
 * scripts/import-products.js
 *
 * One-time product import script. Parses the existing Shopify-export HTML
 * product pages + image-manifest.txt, extracts product name/price/description/
 * images/variants, and inserts rows into the products table.
 *
 * Does NOT touch or require image bytes — only filenames from the manifest.
 *
 * Usage:
 *   node src/scripts/import-products.js \
 *     --manifest /path/to/image-manifest.txt \
 *     --site-root /path/to/extracted-site \
 *
 * Or via env vars:
 *   MANIFEST_PATH=/path/to/image-manifest.txt
 *   SITE_ROOT=/path/to/extracted-site
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return process.env[name.toUpperCase().replace(/-/g, '_')];
}

const MANIFEST_PATH = getArg('manifest') || getArg('manifest-path');
const SITE_ROOT = getArg('site-root') || getArg('site-root');

if (!MANIFEST_PATH || !SITE_ROOT) {
  console.error('ERROR: Both --manifest and --site-root are required.');
  console.error('  Usage: node import-products.js --manifest /path/to/image-manifest.txt --site-root /path/to/site');
  process.exit(1);
}

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`ERROR: Manifest not found at ${MANIFEST_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(SITE_ROOT)) {
  console.error(`ERROR: Site root not found at ${SITE_ROOT}`);
  process.exit(1);
}

// ---- Step 1: Parse manifest → oldName→newName map ----
function parseManifest(manifestPath) {
  const content = fs.readFileSync(manifestPath, 'utf8');
  const lines = content.split('\n');
  const map = {}; // oldName -> newName
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length >= 2) {
      const newName = parts[0];
      const oldName = parts[1];
      map[oldName] = newName;
    }
  }
  return map;
}

// ---- Step 2: Extract product data from HTML ----
function extractProductFromHTML(html) {
  let name = null;
  let priceCents = null;
  let currency = 'EGP';
  let description = null;
  let variants = [];
  let productId = null;

  // Primary source: the embedded `var meta = {"product":{...}}` JSON block
  // This is the most reliable — Shopify embeds structured product data
  const metaMatch = html.match(/var\s+meta\s*=\s*(\{"product":\{[^]*?\}\s*\}\s*\}\s*)\s*;/);
  if (metaMatch) {
    try {
      // The regex above may not be greedy enough for the full object;
      // try a more robust extraction by finding the JSON boundary
      const start = html.indexOf('var meta = ');
      if (start !== -1) {
        let jsonStr = html.slice(start + 'var meta = '.length);
        // Find the matching closing brace
        let depth = 0;
        let end = -1;
        for (let i = 0; i < jsonStr.length; i++) {
          if (jsonStr[i] === '{') depth++;
          else if (jsonStr[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
        if (end !== -1) {
          jsonStr = jsonStr.slice(0, end + 1);
          const meta = JSON.parse(jsonStr);
          if (meta.product) {
            const p = meta.product;
            name = p.title || p.name || null;
            productId = p.id || null;
            if (p.variants && p.variants.length > 0) {
              priceCents = p.variants[0].price;
              currency = p.variants[0].currency || 'EGP';
              variants = p.variants.map((v, i) => ({
                variant_title: v.name || v.public_title || v.title || `Variant ${i + 1}`,
                price_cents: v.price,
                currency: v.currency || currency,
                sku: v.sku || null,
                sort_order: i,
              }));
            }
          }
        }
      }
    } catch (e) {
      // JSON parse failed — fall through to other extraction methods
    }
  }

  // Fallback 1: og:price:amount meta tag
  if (priceCents === null) {
    const ogPriceMatch = html.match(/<meta\s+property="og:price:amount"\s+content="([^"]+)"/i);
    const ogCurrencyMatch = html.match(/<meta\s+property="og:price:currency"\s+content="([A-Z]{3})"/i);
    if (ogPriceMatch) {
      const amount = parseFloat(ogPriceMatch[1].replace(/,/g, ''));
      priceCents = Math.round(amount * 100);
      if (ogCurrencyMatch) currency = ogCurrencyMatch[1];
    }
  }

  // Fallback 2: <h1> for product name
  if (!name) {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      name = h1Match[1].trim();
    }
  }

  // Fallback 3: <title> tag (strip " – Zezoyah" suffix)
  if (!name) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      name = titleMatch[1].replace(/\s*[–-]\s*Zezoyah\s*$/i, '').trim();
    }
  }

  // Description: look for the product description block
  // Dawn theme uses <div class="product__description rte">
  const descMatch = html.match(
    /<div[^>]*class="[^"]*product__description[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/div>)/i
  );
  if (descMatch) {
    // Strip HTML tags from description, keep text
    description = descMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (description.length > 2000) description = description.slice(0, 2000) + '...';
  }

  return { name, priceCents, currency, description, variants, productId };
}

// ---- Step 3: Extract image references from HTML ----
// Handles THREE cases:
//   Case A: HTML references OLD Shopify names (e.g. img/rn-image_picker_lib_temp_XXX.jpg)
//           → uses manifest OLD_NAME→NEW_NAME mapping
//   Case B: HTML already references NEW sequential names via a local
//           path (e.g. img/img_0001.jpg) → uses the filename directly
//   Case C: HTML already references NEW sequential names via the API
//           (e.g. http://localhost:4000/api/images/img_0001.jpg or
//           just /api/images/img_0001.jpg) → uses the filename directly.
//           This is the URL shape produced by
//           migration-scripts/01-rename-and-map-images.js, which rewrites
//           every image reference to point at the backend's image API
//           instead of a local img/ folder. Without this case, every
//           already-migrated product page has ZERO extractable image refs
//           (the old "img/<name>" regex never matches "api/images/<name>"),
//           so it gets wrongly flagged as "no images found/mapped" even
//           though the images are right there in the HTML.
function extractImageRefs(html, oldToNew) {
  const refs = []; // array of { oldName, newName } in order of appearance
  const seen = new Set();

  // Case C: already-migrated API image URLs (checked first — these are
  // unambiguous and don't need manifest lookup at all)
  const apiRefsRegex = /api\/images\/([A-Za-z0-9_.\-]+)/g;
  let am;
  while ((am = apiRefsRegex.exec(html)) !== null) {
    const refName = am[1];
    if (seen.has(refName)) continue;
    seen.add(refName);
    refs.push({ oldName: refName, newName: refName });
  }

  // Collect all img/ references in order of appearance (Cases A and B)
  const allRefsRegex = /(?<!api\/)img\/([A-Za-z0-9_.\-]+)/g;
  let m;
  while ((m = allRefsRegex.exec(html)) !== null) {
    const refName = m[1]; // whatever is after "img/"
    if (seen.has(refName)) continue;

    // Case B: the reference is ALREADY a sequential name (img_XXXX.ext)
    // → use it directly. This happens if the migration script already rewrote the HTML.
    if (/^img_\d{4}\.(jpg|jpeg|png|webp|gif)$/i.test(refName)) {
      seen.add(refName);
      refs.push({ oldName: refName, newName: refName });
      continue;
    }

    // Case A: the reference is an OLD Shopify name (UUID, Untitled_design, etc.)
    // → look it up in the manifest to get the NEW sequential name
    const newName = oldToNew[refName];
    if (newName) {
      seen.add(refName);
      refs.push({ oldName: refName, newName });
    } else {
      // Reference not found in manifest AND not already a sequential name
      // → log it so the user knows this image is missing
      console.warn(`  ⚠️  Image reference not found in manifest: img/${refName}`);
    }
  }

  return refs;
}

// ---- Step 4: Determine which HTML files are product pages ----
function isProductPage(filename, html) {
  // Product pages have the `var meta = {"product":` marker
  // OR a canonical URL containing /products/
  if (html.includes('var meta = {"product"')) return true;
  if (html.includes('href="https://zezoyah.com/products/')) return true;
  // Exclude known non-product pages
  const nonProduct = [
    'index.html', 'cart.html', 'login.html', 'contact.html',
    'all-products.html', 'all.html',
    'privacy-policy.html', 'refund-policy.html', 'shipping-policy.html',
  ];
  if (nonProduct.includes(filename)) return false;
  // Check for category/collection pages (they have collection-list or product-grid but no var meta)
  if (html.includes('template-collection') && !html.includes('var meta = {"product"')) return false;
  return false; // Default: if no var meta, treat as non-product
}

// ---- Check for optional product-images.json override file ----
// If this file exists in the server root, it's used INSTEAD of HTML image scraping.
// The user can edit it directly to control which images belong to which product.
const OVERRIDE_PATH = path.join(__dirname, '..', '..', 'product-images.json');
let overrideConfig = null;
if (fs.existsSync(OVERRIDE_PATH)) {
  try {
    overrideConfig = JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8'));
    console.log(`✓ Found product-images.json override at ${OVERRIDE_PATH}`);
    console.log(`  → Will use explicit image mappings for ${Object.keys(overrideConfig.products || {}).length} products\n`);
  } catch (e) {
    console.warn(`⚠️  product-images.json exists but is invalid JSON: ${e.message}`);
    console.warn(`    Falling back to HTML image scraping.\n`);
    overrideConfig = null;
  }
}

// ---- Main import ----
function main() {
  console.log('\n=== Zezoyah Product Import ===\n');
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Site root: ${SITE_ROOT}`);
  if (overrideConfig) {
    console.log(`Override file: ${OVERRIDE_PATH}`);
  }
  console.log('');

  const oldToNew = parseManifest(MANIFEST_PATH);
  console.log(`Parsed manifest: ${Object.keys(oldToNew).length} image mappings`);

  const htmlFiles = fs
    .readdirSync(SITE_ROOT)
    .filter((f) => f.endsWith('.html'))
    .sort();

  console.log(`Found ${htmlFiles.length} HTML files in site root\n`);

  const needsReview = [];
  let importedCount = 0;
  let skippedCount = 0;

  const upsertProduct = db.transaction(
    (slug, name, description, priceCents, currency, variants, images) => {
      // Upsert product
      const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
      let productId;
      if (existing) {
        db.prepare(
          'UPDATE products SET name = ?, description = ?, price_cents = ?, currency = ? WHERE id = ?'
        ).run(name, description, priceCents, currency, existing.id);
        productId = existing.id;
        // Clear old images and variants (will re-insert)
        db.prepare('DELETE FROM product_images WHERE product_id = ?').run(productId);
        db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
      } else {
        const result = db
          .prepare(
            'INSERT INTO products (slug, name, description, price_cents, currency) VALUES (?, ?, ?, ?, ?)'
          )
          .run(slug, name, description, priceCents, currency);
        productId = result.lastInsertRowid;
      }

      // Insert images
      for (let i = 0; i < images.length; i++) {
        db.prepare(
          'INSERT INTO product_images (product_id, filename, sort_order) VALUES (?, ?, ?)'
        ).run(productId, images[i], i);
      }

      // Insert variants
      for (const v of variants) {
        db.prepare(
          'INSERT INTO product_variants (product_id, variant_title, price_cents, currency, sku, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(productId, v.variant_title, v.price_cents, v.currency, v.sku, v.sort_order);
      }

      return productId;
    }
  );

  for (const filename of htmlFiles) {
    const filePath = path.join(SITE_ROOT, filename);
    const html = fs.readFileSync(filePath, 'utf8');

    if (!isProductPage(filename, html)) {
      skippedCount++;
      continue;
    }

    const slug = filename.replace(/\.html$/, '');

    // ---- OVERRIDE MODE: use product-images.json if it has an entry for this slug ----
    let extracted, images;
    if (overrideConfig && overrideConfig.products && overrideConfig.products[slug]) {
      const cfg = overrideConfig.products[slug];
      extracted = {
        name: cfg.name || null,
        priceCents: cfg.price_cents !== undefined ? cfg.price_cents : null,
        currency: cfg.currency || 'EGP',
        description: cfg.description || '',
        variants: [], // override mode does not include variants — keep existing or empty
      };
      images = Array.isArray(cfg.images) ? cfg.images : [];
      console.log(`  → ${slug}: using OVERRIDE config (${images.length} images)`);
    } else {
      // ---- DEFAULT MODE: scrape product data + images from HTML ----
      extracted = extractProductFromHTML(html);
      images = extractImageRefs(html, oldToNew).map((r) => r.newName);
    }

    // Validate extraction
    const issues = [];
    if (!extracted.name) issues.push('missing product name');
    if (extracted.priceCents === null) issues.push('missing price');
    if (images.length === 0) issues.push('no images found/mapped');

    if (issues.length > 0) {
      needsReview.push({
        file: filename,
        slug,
        issues,
        extracted_name: extracted.name,
        extracted_price: extracted.priceCents,
        image_count: images.length,
      });
      // Still insert what we have (name from filename fallback, price 0)
      // so the product exists in the DB — user can fix manually
      const fallbackName = slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      const finalName = extracted.name || fallbackName;
      const finalPrice = extracted.priceCents !== null ? extracted.priceCents : 0;
      try {
        upsertProduct(
          slug,
          finalName,
          extracted.description,
          finalPrice,
          extracted.currency,
          extracted.variants,
          images
        );
        importedCount++;
      } catch (err) {
        needsReview[needsReview.length - 1].issues.push(`DB_ERROR: ${err.message}`);
      }
      continue;
    }

    try {
      upsertProduct(
        slug,
        extracted.name,
        extracted.description,
        extracted.priceCents,
        extracted.currency,
        extracted.variants,
        images
      );
      importedCount++;
      console.log(
        `  ✓ ${slug}: "${extracted.name}" — ${extracted.priceCents} ${extracted.currency} — ${images.length} images — ${extracted.variants.length} variants`
      );
    } catch (err) {
      console.error(`  ✗ ${slug}: DB error — ${err.message}`);
      needsReview.push({
        file: filename,
        slug,
        issues: [`DB_ERROR: ${err.message}`],
        extracted_name: extracted.name,
        extracted_price: extracted.priceCents,
        image_count: images.length,
      });
    }
  }

  console.log('\n=== Import Complete ===\n');
  console.log(`  Imported: ${importedCount} products`);
  console.log(`  Skipped (non-product pages): ${skippedCount}`);

  if (needsReview.length > 0) {
    console.log(`\n=== ⚠️  NEEDS MANUAL REVIEW (${needsReview.length} pages) ===\n`);
    for (const item of needsReview) {
      console.log(`  ${item.file} (slug: ${item.slug})`);
      console.log(`    Issues: ${item.issues.join(', ')}`);
      console.log(`    Extracted name: ${item.extracted_name || '(none)'}`);
      console.log(`    Extracted price: ${item.extracted_price !== null ? item.extracted_price + ' cents' : '(none)'}`);
      console.log(`    Image count: ${item.image_count}`);
      console.log('');
    }
  }

  // Write review list to a file for reference
  if (needsReview.length > 0) {
    const reviewPath = path.join(__dirname, '..', '..', 'NEEDS-MANUAL-REVIEW.txt');
    fs.writeFileSync(
      reviewPath,
      `Zezoyah Product Import — Needs Manual Review\n` +
        `Generated: ${new Date().toISOString()}\n\n` +
        needsReview
          .map(
            (item) =>
              `${item.file} (slug: ${item.slug})\n  Issues: ${item.issues.join(', ')}\n  Name: ${item.extracted_name || '(none)'}\n  Price: ${item.extracted_price !== null ? item.extracted_price + ' cents' : '(none)'}\n  Images: ${item.image_count}\n`
          )
          .join('\n'),
      'utf8'
    );
    console.log(`  Review list written to: ${reviewPath}\n`);
  }
}

main();
