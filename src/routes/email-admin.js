/**
 * routes/email-admin.js — Email management routes
 * 
 * POST   /api/email/subscribe          — Subscribe to marketing emails
 * DELETE /api/email/unsubscribe        — Unsubscribe from marketing emails
 * GET    /api/email/subscribers        — List subscribers (admin)
 * POST   /api/email/trigger-abandoned  — Manually trigger abandoned cart job
 * POST   /api/email/trigger-sale       — Manually trigger sale announcement job
 * POST   /api/email/sales              — Create a new sale
 * GET    /api/email/sales              — List all sales
 * GET    /api/email/log                — View email send log
 * GET    /api/email/stats              — Email statistics
 */

const express = require('express');
const { db } = require('../db');
const { sendAbandonedCartReminders } = require('../jobs/abandoned-cart-job');
const { sendSaleAnnouncements } = require('../jobs/sale-announcement-job');

const router = express.Router();

/**
 * POST /api/email/subscribe
 * Body: { email, source? }
 */
router.post('/subscribe', (req, res) => {
  const { email, source } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    // Check if already subscribed
    const existing = db.prepare('SELECT * FROM email_subscribers WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      if (existing.is_active) {
        return res.status(200).json({ message: 'Already subscribed' });
      }
      // Re-subscribe
      db.prepare('UPDATE email_subscribers SET is_active = 1, subscribed_at = datetime("now") WHERE id = ?').run(existing.id);
      return res.status(200).json({ message: 'Re-subscribed successfully' });
    }

    db.prepare('INSERT INTO email_subscribers (email, source) VALUES (?, ?)').run(email.toLowerCase(), source || 'footer');
    res.status(201).json({ message: 'Subscribed successfully' });
  } catch (err) {
    console.error('[email/subscribe] Error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

/**
 * DELETE /api/email/unsubscribe
 * Body: { email }
 * Or GET /api/email/unsubscribe?email=xxx (for email link clicks)
 */
router.delete('/unsubscribe', (req, res) => {
  const email = (req.body?.email || req.query?.email || '').toLowerCase();

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    db.prepare('UPDATE email_subscribers SET is_active = 0 WHERE email = ?').run(email);
    res.json({ message: 'Unsubscribed successfully' });
  } catch (err) {
    console.error('[email/unsubscribe] Error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Also support GET for email link clicks
router.get('/unsubscribe', (req, res) => {
  const email = (req.query?.email || '').toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  try {
    db.prepare('UPDATE email_subscribers SET is_active = 0 WHERE email = ?').run(email);
    // Return a simple HTML confirmation page
    res.send(`<!DOCTYPE html><html><head><title>Unsubscribed</title></head><body style="font-family:sans-serif;max-width:500px;margin:80px auto;text-align:center;"><h1>Unsubscribed</h1><p>You have been unsubscribed from Zezoyah marketing emails.</p><p><a href="${process.env.FRONTEND_URL || 'https://zezoyah.com'}">Return to Zezoyah</a></p></body></html>`);
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

/**
 * GET /api/email/subscribers
 * Query: ?page=1&limit=50
 */
router.get('/subscribers', (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  const offset = (page - 1) * limit;

  try {
    const subscribers = db.prepare(`
      SELECT email, source, subscribed_at, is_active
      FROM email_subscribers
      ORDER BY subscribed_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const count = db.prepare('SELECT COUNT(*) as total FROM email_subscribers').get();

    res.json({
      subscribers,
      pagination: {
        page,
        limit,
        total: count.total,
        pages: Math.ceil(count.total / limit),
      },
    });
  } catch (err) {
    console.error('[email/subscribers] Error:', err);
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
});

/**
 * POST /api/email/sales
 * Body: { title, message, discount_percent, starts_at, ends_at, product_slugs? }
 */
router.post('/sales', (req, res) => {
  const { title, message, discount_percent, starts_at, ends_at, product_slugs } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO sales (title, message, discount_percent, starts_at, ends_at, product_slugs)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      title,
      message || null,
      discount_percent || null,
      starts_at || new Date().toISOString(),
      ends_at || null,
      product_slugs ? JSON.stringify(product_slugs) : null
    );

    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ sale });
  } catch (err) {
    console.error('/api/email/sales] Error:', err);
    res.status(500).json({ error: 'Failed to create sale' });
  }
});

/**
 * GET /api/email/sales
 */
router.get('/sales', (req, res) => {
  try {
    const sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC').all();
    res.json({ sales });
  } catch (err) {
    console.error('[email/sales] Error:', err);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
});

/**
 * POST /api/email/trigger-abandoned
 * Body: { hoursOld?, maxReminders?, reminderCooldownHours? }
 */
router.post('/trigger-abandoned', async (req, res) => {
  try {
    const result = await sendAbandonedCartReminders(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[email/trigger-abandoned] Error:', err);
    res.status(500).json({ error: 'Failed to trigger abandoned cart job' });
  }
});

/**
 * POST /api/email/trigger-sale
 */
router.post('/trigger-sale', async (req, res) => {
  try {
    const result = await sendSaleAnnouncements();
    res.json(result);
  } catch (err) {
    console.error('[email/trigger-sale] Error:', err);
    res.status(500).json({ error: 'Failed to trigger sale job' });
  }
});

/**
 * GET /api/email/log
 * Query: ?type=abandoned_cart&limit=50&page=1
 */
router.get('/log', (req, res) => {
  const { type, limit = 50, page = 1 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let query = 'SELECT * FROM email_log';
    let countQuery = 'SELECT COUNT(*) as total FROM email_log';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      countQuery += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY sent_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const logs = db.prepare(query).all(...params);
    const count = db.prepare(countQuery).get(...(type ? [type] : []));

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count.total,
      },
    });
  } catch (err) {
    console.error('[email/log] Error:', err);
    res.status(500).json({ error: 'Failed to fetch email log' });
  }
});

/**
 * GET /api/email/stats
 */
router.get('/stats', (req, res) => {
  try {
    const totalSubscribers = db.prepare('SELECT COUNT(*) as count FROM email_subscribers WHERE is_active = 1').get();
    const totalSent = db.prepare('SELECT COUNT(*) as count FROM email_log WHERE status = "sent"').get();
    const totalFailed = db.prepare('SELECT COUNT(*) as count FROM email_log WHERE status = "failed"').get();
    const byType = db.prepare('SELECT type, COUNT(*) as count FROM email_log GROUP BY type').all();
    const recentActivity = db.prepare('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 10').all();

    res.json({
      subscribers: totalSubscribers.count,
      emails_sent: totalSent.count,
      emails_failed: totalFailed.count,
      by_type: byType,
      recent_activity: recentActivity,
    });
  } catch (err) {
    console.error('[email/stats] Error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
