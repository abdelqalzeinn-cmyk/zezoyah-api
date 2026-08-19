/**
 * routes/cart-helpers.js — Shared cart logic
 *
 * Cart identity approach (documented in README):
 * - Logged-in users: cart tied to user_id (one cart per user)
 * - Guest users: cart tied to a random cart_cookie (zezoyah_cart_id cookie)
 * - On login/register: guest cart is merged into user's existing cart
 *   (matching product+variant → sum quantities; non-matching → moved to user cart)
 *
 * This approach was chosen because:
 * 1. Guests can shop without creating an account (lower friction)
 * 2. Logged-in users get a persistent cart across sessions
 * 3. Merging prevents cart loss on login (common e-commerce UX)
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');

/**
 * Get or create a cart for the current request.
 * - If user is logged in, use user's cart (create if none)
 * - If guest, use cart_cookie (zezoyah_cart_id), create if none
 */
function getOrCreateCart(req, res) {
  if (req.user) {
    // Logged-in user
    let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(req.user.id);
    if (!cart) {
      const result = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(req.user.id);
      cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(result.lastInsertRowid);
    }
    return cart;
  }

  // Guest — use cookie
  let cartCookie = req.cookies && req.cookies.zezoyah_cart_id;
  let cart = null;
  if (cartCookie) {
    cart = db.prepare('SELECT * FROM carts WHERE cart_cookie = ?').get(cartCookie);
  }
  if (!cart) {
    cartCookie = uuidv4();
    const result = db.prepare('INSERT INTO carts (cart_cookie) VALUES (?)').run(cartCookie);
    cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(result.lastInsertRowid);
    // Set the cookie (10 year expiry — cart is long-lived for guests)
    const isLocalDev = (process.env.FRONTEND_ORIGIN || '').includes('localhost');
    res.cookie('zezoyah_cart_id', cartCookie, {
      httpOnly: true,
      maxAge: 10 * 365 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: isLocalDev ? 'lax' : 'none',
      secure: isLocalDev ? false : true,
    });
  }
  return cart;
}

/**
 * Build the full cart response with product details joined in.
 */
function buildCartResponse(cartId) {
  const items = db
    .prepare(`
      SELECT
        ci.id,
        ci.product_id,
        ci.variant_id,
        ci.quantity,
        p.slug as product_slug,
        p.name as product_name,
        p.currency,
        pv.variant_title,
        pv.price_cents as variant_price_cents,
        p.price_cents as product_price_cents,
        (SELECT filename FROM product_images pi WHERE pi.product_id = ci.product_id ORDER BY pi.sort_order LIMIT 1) as image
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.cart_id = ?
      ORDER BY ci.id
    `)
    .all(cartId);

  const formattedItems = items.map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_slug: item.product_slug,
    product_name: item.product_name,
    variant_id: item.variant_id,
    variant_title: item.variant_title,
    quantity: item.quantity,
    unit_price_cents: item.variant_price_cents || item.product_price_cents,
    currency: item.currency,
    image: item.image,
  }));

  const itemsCount = formattedItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = formattedItems.reduce(
    (sum, item) => sum + item.unit_price_cents * item.quantity,
    0
  );
  const currency = formattedItems.length > 0 ? formattedItems[0].currency : 'EGP';

  return {
    cart: {
      id: cartId,
      items: formattedItems,
    },
    totals: {
      items_count: itemsCount,
      total_cents: totalCents,
      currency,
    },
  };
}

/**
 * Merge a guest cart (identified by cart_cookie) into a user's cart.
 * - For each item in guest cart: if user cart has same product+variant, add quantities
 * - Otherwise, move the item to the user's cart
 * - Delete the guest cart afterwards
 */
function mergeGuestCart(cartCookie, userId) {
  const guestCart = db.prepare('SELECT * FROM carts WHERE cart_cookie = ?').get(cartCookie);
  if (!guestCart) return;

  let userCart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
  if (!userCart) {
    db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(userId);
    userCart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
  }

  const guestItems = db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(guestCart.id);

  const merge = db.transaction(() => {
    for (const gi of guestItems) {
      const existing = db
        .prepare('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ? AND (variant_id = ? OR (variant_id IS NULL AND ? IS NULL))')
        .get(userCart.id, gi.product_id, gi.variant_id, gi.variant_id);

      if (existing) {
        db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(
          gi.quantity,
          existing.id
        );
        db.prepare('DELETE FROM cart_items WHERE id = ?').run(gi.id);
      } else {
        db.prepare('UPDATE cart_items SET cart_id = ? WHERE id = ?').run(userCart.id, gi.id);
      }
    }
    db.prepare('DELETE FROM carts WHERE id = ?').run(guestCart.id);
  });

  merge();
}

module.exports = { getOrCreateCart, buildCartResponse, mergeGuestCart };
