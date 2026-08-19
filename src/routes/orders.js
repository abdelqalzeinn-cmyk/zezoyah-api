/**
 * routes/orders.js — Order management and creation routes
 *
 * POST /api/orders — Create a new order from current cart (guest or user)
 * GET /api/orders/:id — Retrieve order details by ID or order_number
 */
const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getOrCreateCart } = require('./cart-helpers');

const router = express.Router();

router.use(authMiddleware);

/**
 * Generate unique order number (e.g. ZZ-1001 or timestamp based)
 */
function generateOrderNumber() {
  const prefix = 'ZZ';
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${rand}`;
}

/**
 * POST /api/orders
 * Body: { customer_name, customer_phone, shipping_address, customer_email?, shipping_city?, notes? }
 */
router.post('/', (req, res) => {
  const {
    customer_name,
    customer_phone,
    shipping_address,
    customer_email,
    shipping_city,
    notes,
  } = req.body;

  if (!customer_name || !customer_name.trim()) {
    return res.status(400).json({ error: 'Customer name is required' });
  }
  if (!customer_phone || !customer_phone.trim()) {
    return res.status(400).json({ error: 'Customer phone number is required' });
  }
  if (!shipping_address || !shipping_address.trim()) {
    return res.status(400).json({ error: 'Shipping address is required' });
  }

  try {
    const cart = getOrCreateCart(req, res);

    // Get cart items with product details
    const items = db
      .prepare(
        `SELECT ci.*, p.name as product_name, p.price_cents as product_price, p.currency as product_currency,
                pv.variant_title, pv.price_cents as variant_price
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN product_variants pv ON ci.variant_id = pv.id
         WHERE ci.cart_id = ?`
      )
      .all(cart.id);

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty' });
    }

    let subtotal_cents = 0;
    const currency = items[0].product_currency || 'EGP';

    const orderItemsToInsert = items.map((item) => {
      const unit_price_cents = item.variant_price != null ? item.variant_price : item.product_price;
      subtotal_cents += unit_price_cents * item.quantity;
      return {
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        product_name: item.product_name,
        variant_title: item.variant_title || null,
        unit_price_cents,
        quantity: item.quantity,
      };
    });

    const order_number = generateOrderNumber();
    const city = shipping_city && shipping_city.trim() ? shipping_city.trim() : 'Cairo';
    const email = customer_email ? customer_email.trim() : (req.user ? req.user.email : null);
    const userId = req.user ? req.user.id : null;
    const cartCookie = req.cookies ? req.cookies.cart_cookie : null;

    // Use transaction to create order, insert order items, and clear cart
    const createOrderTransaction = db.transaction(() => {
      const orderStmt = db.prepare(`
        INSERT INTO orders (
          order_number, user_id, cart_cookie, customer_name, customer_phone,
          customer_email, shipping_address, shipping_city, notes, status,
          subtotal_cents, currency
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);

      const info = orderStmt.run(
        order_number,
        userId,
        cartCookie,
        customer_name.trim(),
        customer_phone.trim(),
        email,
        shipping_address.trim(),
        city,
        notes || null,
        subtotal_cents,
        currency
      );

      const orderId = info.lastInsertRowid;

      const itemStmt = db.prepare(`
        INSERT INTO order_items (
          order_id, product_id, variant_id, product_name, variant_title, unit_price_cents, quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of orderItemsToInsert) {
        itemStmt.run(
          orderId,
          item.product_id,
          item.variant_id,
          item.product_name,
          item.variant_title,
          item.unit_price_cents,
          item.quantity
        );
      }

      // Clear cart items
      db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);

      return orderId;
    });

    const orderId = createOrderTransaction();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

    res.status(201).json({
      order,
      items: orderItems,
    });
  } catch (err) {
    console.error('[orders/create] Error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/**
 * GET /api/orders/:id
 */
router.get('/:id', (req, res) => {
  const param = req.params.id;
  try {
    let order;
    if (/^\d+$/.test(param)) {
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(param, 10));
    } else {
      order = db.prepare('SELECT * FROM orders WHERE order_number = ?').get(param);
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    res.json({
      order,
      items,
    });
  } catch (err) {
    console.error('[orders/get] Error:', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

module.exports = router;
