/**
 * abandoned-cart-job.js — Abandoned cart reminder cron job
 * 
 * Runs periodically to find carts with items that haven't been checked out
 * and sends reminder emails to users who have email addresses.
 * 
 * Schedule: Runs every hour by default
 * Logic:
 * 1. Find carts with items that are older than X hours (default: 2)
 * 2. Exclude carts that already have orders
 * 3. Exclude carts that already received a reminder recently
 * 4. Send reminder email
 * 5. Log the reminder
 */

const { db } = require('../db');
const { sendEmail, buildEmailTemplate, buildAbandonedCartContent } = require('../services/email-service');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://zezoyah.com';

/**
 * Find abandoned carts that need reminders
 * @param {number} hoursOld - Minimum age of cart in hours (default: 2)
 * @param {number} maxReminders - Max reminders per cart (default: 2)
 * @param {number} reminderCooldownHours - Hours between reminders (default: 24)
 */
function findAbandonedCarts(hoursOld = 2, maxReminders = 2, reminderCooldownHours = 24) {
  const cutoffTime = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();
  const cooldownTime = new Date(Date.now() - reminderCooldownHours * 60 * 60 * 1000).toISOString();

  // Find carts with items that:
  // 1. Are older than cutoffTime
  // 2. Don't have an associated order
  // 3. Haven't been reminded recently (or haven't reached max reminders)
  const query = `
    SELECT 
      c.id as cart_id,
      c.user_id,
      c.cart_cookie,
      u.email as user_email,
      COUNT(ci.id) as item_count,
      MAX(ci.created_at) as last_item_added
    FROM carts c
    JOIN cart_items ci ON ci.cart_id = c.id
    LEFT JOIN users u ON u.id = c.user_id
    WHERE ci.created_at < ?
      AND c.id NOT IN (
        SELECT cart_id FROM orders WHERE cart_id IS NOT NULL
      )
      AND c.id NOT IN (
        SELECT cart_id FROM abandoned_cart_log 
        WHERE sent_at > ? OR reminder_number >= ?
      )
    GROUP BY c.id
    HAVING item_count > 0
    ORDER BY last_item_added ASC
    LIMIT 50
  `;

  return db.prepare(query).all(cutoffTime, cooldownTime, maxReminders);
}

/**
 * Get full cart details for email
 */
function getCartDetails(cartId) {
  const items = db.prepare(`
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
  `).all(cartId);

  const formattedItems = items.map(item => ({
    ...item,
    unit_price_cents: item.variant_price_cents || item.product_price_cents,
  }));

  const totalCents = formattedItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

  return {
    items: formattedItems,
    totals: {
      items_count: formattedItems.reduce((sum, item) => sum + item.quantity, 0),
      total_cents: totalCents,
      currency: formattedItems[0]?.currency || 'EGP',
    },
  };
}

/**
 * Send abandoned cart reminder emails
 */
async function sendAbandonedCartReminders(options = {}) {
  const { hoursOld = 2, maxReminders = 2, reminderCooldownHours = 24 } = options;

  const abandonedCarts = findAbandonedCarts(hoursOld, maxReminders, reminderCooldownHours);

  if (abandonedCarts.length === 0) {
    console.log('[abandoned-cart] No abandoned carts found');
    return { sent: 0, skipped: 0 };
  }

  console.log(`[abandoned-cart] Found ${abandonedCarts.length} abandoned carts`);

  let sent = 0;
  let skipped = 0;

  for (const cart of abandonedCarts) {
    try {
      // Skip carts without email (guest carts without user)
      if (!cart.user_email) {
        skipped++;
        continue;
      }

      const { items, totals } = getCartDetails(cart.cart_id);

      if (items.length === 0) {
        skipped++;
        continue;
      }

      // Build email
      const content = buildAbandonedCartContent(items, totals, `${FRONTEND_URL}/cart.html`);
      const html = buildEmailTemplate({
        title: 'Your cart is waiting',
        preheader: `You have ${items.length} item${items.length > 1 ? 's' : ''} in your cart`,
        content,
        ctaText: 'Complete your order',
        ctaUrl: `${FRONTEND_URL}/cart.html`,
        unsubscribeUrl: `${FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(cart.user_email)}`,
      });

      const result = await sendEmail({
        to: cart.user_email,
        subject: `Your cart is waiting ❤ — ${items.length} item${items.length > 1 ? 's' : ''} left`,
        text: `You have items waiting in your cart. Complete your order at ${FRONTEND_URL}/cart.html`,
        html,
      });

      // Log the reminder
      db.prepare(`
        INSERT INTO abandoned_cart_log (cart_id, email, reminder_number, status)
        VALUES (?, ?, COALESCE((SELECT MAX(reminder_number) FROM abandoned_cart_log WHERE cart_id = ?), 0) + 1, ?)
      `).run(cart.cart_id, cart.user_email, cart.cart_id, result.success ? 'sent' : 'failed');

      // Log to email_log
      db.prepare(`
        INSERT INTO email_log (email, type, subject, status, metadata)
        VALUES (?, 'abandoned_cart', ?, ?, ?)
      `).run(
        cart.user_email,
        `Your cart is waiting — ${items.length} item${items.length > 1 ? 's' : ''} left`,
        result.success ? 'sent' : 'failed',
        JSON.stringify({ cart_id: cart.cart_id, items_count: items.length, total_cents: totals.total_cents })
      );

      if (result.success) {
        sent++;
        console.log(`[abandoned-cart] ✓ Sent reminder to ${cart.user_email}`);
      } else {
        skipped++;
        console.log(`[abandoned-cart] ✗ Failed to send to ${cart.user_email}: ${result.error}`);
      }
    } catch (err) {
      skipped++;
      console.error(`[abandoned-cart] Error processing cart ${cart.cart_id}:`, err.message);
    }
  }

  console.log(`[abandoned-cart] Done. Sent: ${sent}, Skipped: ${skipped}`);
  return { sent, skipped };
}

module.exports = {
  sendAbandonedCartReminders,
  findAbandonedCarts,
};
