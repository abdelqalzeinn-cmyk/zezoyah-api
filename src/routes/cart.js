/**
 * routes/cart.js — Cart routes
 *
 * GET    /api/cart            — get current cart (guest or user)
 * POST   /api/cart/items      — add item to cart (body: { product_id, quantity, variant_id? })
 * PATCH  /api/cart/items/:id   — update quantity (body: { quantity }) — quantity 0 removes item
 * DELETE /api/cart/items/:id   — remove item from cart
 */
const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getOrCreateCart, buildCartResponse } = require('./cart-helpers');

const router = express.Router();

router.use(authMiddleware);

/**
 * GET /api/cart
 */
router.get('/', (req, res) => {
  try {
    const cart = getOrCreateCart(req, res);
    const response = buildCartResponse(cart.id);
    res.json(response);
  } catch (err) {
    console.error('[cart/get] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve cart' });
  }
});

/**
 * POST /api/cart/items
 * Body: { product_id, quantity, variant_id? }
 */
router.post('/items', (req, res) => {
  const { product_id, quantity, variant_id } = req.body;

  if (!product_id || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'Valid product_id and quantity are required' });
  }

  try {
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (variant_id) {
      const variant = db
        .prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?')
        .get(variant_id, product_id);
      if (!variant) {
        return res.status(404).json({ error: 'Variant not found for this product' });
      }
    }

    const cart = getOrCreateCart(req, res);

    // Check if item already exists (same product + variant)
    const existing = db
      .prepare('SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ? AND (variant_id = ? OR (variant_id IS NULL AND ? IS NULL))')
      .get(cart.id, product_id, variant_id || null, variant_id || null);

    if (existing) {
      db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?').run(
        quantity,
        existing.id
      );
    } else {
      db.prepare(
        'INSERT INTO cart_items (cart_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)'
      ).run(cart.id, product_id, variant_id || null, quantity);
    }

    const response = buildCartResponse(cart.id);
    res.status(201).json(response);
  } catch (err) {
    console.error('[cart/add] Error:', err);
    res.status(500).json({ error: 'Failed to add item to cart' });
  }
});

/**
 * PATCH /api/cart/items/:id
 * Body: { quantity }
 */
router.patch('/items/:id', (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const { quantity } = req.body;

  if (!quantity || quantity < 0) {
    return res.status(400).json({ error: 'Valid quantity is required' });
  }

  try {
    const cart = getOrCreateCart(req, res);
    const item = db
      .prepare('SELECT * FROM cart_items WHERE id = ? AND cart_id = ?')
      .get(itemId, cart.id);

    if (!item) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    if (quantity === 0) {
      db.prepare('DELETE FROM cart_items WHERE id = ?').run(itemId);
    } else {
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, itemId);
    }

    const response = buildCartResponse(cart.id);
    res.json(response);
  } catch (err) {
    console.error('[cart/update] Error:', err);
    res.status(500).json({ error: 'Failed to update cart item' });
  }
});

/**
 * DELETE /api/cart/items/:id
 */
router.delete('/items/:id', (req, res) => {
  const itemId = parseInt(req.params.id, 10);

  try {
    const cart = getOrCreateCart(req, res);
    const item = db
      .prepare('SELECT * FROM cart_items WHERE id = ? AND cart_id = ?')
      .get(itemId, cart.id);

    if (!item) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    db.prepare('DELETE FROM cart_items WHERE id = ?').run(itemId);

    const response = buildCartResponse(cart.id);
    res.json(response);
  } catch (err) {
    console.error('[cart/delete] Error:', err);
    res.status(500).json({ error: 'Failed to remove cart item' });
  }
});

module.exports = router;
