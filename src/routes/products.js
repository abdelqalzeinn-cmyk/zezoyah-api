/**
 * routes/products.js — Product routes
 *
 * GET /api/products      — list all products (basic info + first image + variant count)
 * GET /api/products/:slug — full product detail (images + variants)
 */
const express = require('express');
const { db } = require('../db');

const router = express.Router();

/**
 * GET /api/products
 * Optional query: ?search=term  (searches name)
 */
router.get('/', (req, res) => {
  const { search } = req.query;
  let products;
  if (search) {
    products = db
      .prepare('SELECT id, slug, name, price_cents, currency FROM products WHERE name LIKE ? ORDER BY id')
      .all(`%${search}%`);
  } else {
    products = db
      .prepare('SELECT id, slug, name, price_cents, currency FROM products ORDER BY id')
      .all();
  }

  const result = products.map((p) => {
    const firstImage = db
      .prepare('SELECT filename FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1')
      .get(p.id);
    const variantCount = db
      .prepare('SELECT COUNT(*) as count FROM product_variants WHERE product_id = ?')
      .get(p.id);
    return {
      ...p,
      image: firstImage ? firstImage.filename : null,
      variant_count: variantCount ? variantCount.count : 0,
    };
  });

  res.json({ products: result });
});

/**
 * GET /api/products/:slug
 */
router.get('/:slug', (req, res) => {
  const { slug } = req.params;
  const product = db
    .prepare('SELECT id, slug, name, description, price_cents, currency FROM products WHERE slug = ?')
    .get(slug);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const images = db
    .prepare('SELECT filename, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order')
    .all(product.id);

  const variants = db
    .prepare('SELECT id, variant_title as title, price_cents, currency, sku FROM product_variants WHERE product_id = ? ORDER BY sort_order')
    .all(product.id);

  res.json({
    product: {
      ...product,
      images,
      variants,
    },
  });
});

module.exports = router;
