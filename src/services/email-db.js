/**
 * email-db.js — Database helpers for email features
 * 
 * Adds tables for:
 * - email_subscribers: Users who opted in for marketing emails
 * - email_log: Log of all sent emails
 * - sales: Sale configurations
 * - abandoned_cart_log: Track which carts have been reminded
 */

const { db } = require('../db');

function initEmailSchema() {
  db.exec(`
    -- Email subscribers (marketing consent)
    CREATE TABLE IF NOT EXISTS email_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      source TEXT DEFAULT 'footer', -- 'footer', 'checkout', 'popup'
      subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Email send log
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      type TEXT NOT NULL, -- 'abandoned_cart', 'sale', 'welcome', 'order_confirmation'
      subject TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
      error TEXT,
      metadata TEXT -- JSON: { cart_id, sale_id, etc. }
    );

    -- Sales / promotions
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT,
      discount_percent INTEGER,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      product_slugs TEXT, -- JSON array of product slugs (NULL = sitewide)
      email_sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Abandoned cart reminders log
    CREATE TABLE IF NOT EXISTS abandoned_cart_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      reminder_number INTEGER NOT NULL DEFAULT 1, -- 1st, 2nd reminder
      status TEXT NOT NULL DEFAULT 'sent',
      FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_email_subscribers_email ON email_subscribers(email);
    CREATE INDEX IF NOT EXISTS idx_email_subscribers_active ON email_subscribers(is_active);
    CREATE INDEX IF NOT EXISTS idx_email_log_type ON email_log(type);
    CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(email);
    CREATE INDEX IF NOT EXISTS idx_sales_active ON sales(is_active);
    CREATE INDEX IF NOT EXISTS idx_sales_dates ON sales(starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_abandoned_cart_cart ON abandoned_cart_log(cart_id);
  `);

  console.log('[email-db] Email schema initialized');
}

module.exports = { initEmailSchema };
