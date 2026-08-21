/**
 * sale-announcement-job.js — Sale announcement cron job
 * 
 * Runs periodically to check for active sales and sends announcement
 * emails to all subscribed users.
 * 
 * Schedule: Runs every 30 minutes by default
 * Logic:
 * 1. Find active sales that haven't had emails sent yet
 * 2. Get all active email subscribers
 * 3. Send sale announcement to each subscriber
 * 4. Mark sale as email_sent
 */

const { db } = require('../db');
const { sendEmail, buildEmailTemplate, buildSaleContent } = require('../services/email-service');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://zezoyah.com';

/**
 * Find active sales that need email announcements
 */
function findActiveSales() {
  const now = new Date().toISOString();

  return db.prepare(`
    SELECT * FROM sales
    WHERE is_active = 1
      AND starts_at <= ?
      AND (ends_at IS NULL OR ends_at > ?)
      AND email_sent = 0
    ORDER BY starts_at ASC
  `).all(now, now);
}

/**
 * Get all active email subscribers
 */
function getActiveSubscribers() {
  return db.prepare(`
    SELECT email, user_id FROM email_subscribers
    WHERE is_active = 1
    ORDER BY subscribed_at ASC
  `).all();
}

/**
 * Send sale announcement emails
 */
async function sendSaleAnnouncements() {
  const sales = findActiveSales();

  if (sales.length === 0) {
    console.log('[sale-announcement] No active sales to announce');
    return { sent: 0, sales: 0 };
  }

  const subscribers = getActiveSubscribers();

  if (subscribers.length === 0) {
    console.log('[sale-announcement] No active subscribers');
    return { sent: 0, sales: sales.length };
  }

  console.log(`[sale-announcement] Found ${sales.length} sale(s) and ${subscribers.length} subscriber(s)`);

  let totalSent = 0;

  for (const sale of sales) {
    let saleSent = 0;

    for (const subscriber of subscribers) {
      try {
        // Build email
        const content = buildSaleContent({
          title: sale.title,
          message: sale.message,
          discount_percent: sale.discount_percent,
          product_slugs: sale.product_slugs ? JSON.parse(sale.product_slugs) : null,
        });

        const html = buildEmailTemplate({
          title: sale.title || 'Sale at Zezoyah!',
          preheader: sale.message || 'Check out our latest sale',
          content,
          ctaText: 'Shop the sale',
          ctaUrl: `${FRONTEND_URL}/sale`,
          unsubscribeUrl: `${FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(subscriber.email)}`,
        });

        const result = await sendEmail({
          to: subscriber.email,
          subject: sale.title || 'Big Sale at Zezoyah! 🎉',
          text: sale.message || 'Check out our latest sale at ' + FRONTEND_URL,
          html,
        });

        // Log to email_log
        db.prepare(`
          INSERT INTO email_log (email, type, subject, status, metadata)
          VALUES (?, 'sale', ?, ?, ?)
        `).run(
          subscriber.email,
          sale.title || 'Big Sale at Zezoyah!',
          result.success ? 'sent' : 'failed',
          JSON.stringify({ sale_id: sale.id })
        );

        if (result.success) {
          saleSent++;
          totalSent++;
        }
      } catch (err) {
        console.error(`[sale-announcement] Error sending to ${subscriber.email}:`, err.message);
      }
    }

    // Mark sale as email_sent
    db.prepare('UPDATE sales SET email_sent = 1 WHERE id = ?').run(sale.id);

    console.log(`[sale-announcement] Sale "${sale.title}": ${saleSent} emails sent`);
  }

  console.log(`[sale-announcement] Done. Total sent: ${totalSent}`);
  return { sent: totalSent, sales: sales.length };
}

module.exports = {
  sendSaleAnnouncements,
  findActiveSales,
  getActiveSubscribers,
};
