/**
 * cron-jobs.js — Scheduled job runner
 * 
 * Runs periodic tasks:
 * 1. Abandoned cart reminders (every hour)
 * 2. Sale announcements (every 30 minutes)
 * 
 * Uses simple setInterval for scheduling (no external dependencies).
 * For production, consider using node-cron or a proper job queue.
 */

const { sendAbandonedCartReminders } = require('./abandoned-cart-job');
const { sendSaleAnnouncements } = require('./sale-announcement-job');

// Configuration from environment variables
const ABANDONED_CART_INTERVAL = parseInt(process.env.ABANDONED_CART_INTERVAL || '3600000', 10); // 1 hour
const SALE_ANNOUNCEMENT_INTERVAL = parseInt(process.env.SALE_ANNOUNCEMENT_INTERVAL || '1800000', 10); // 30 minutes
const ABANDONED_CART_HOURS_OLD = parseInt(process.env.ABANDONED_CART_HOURS_OLD || '2', 10);

let abandonedCartTimer = null;
let saleAnnouncementTimer = null;

/**
 * Start all cron jobs
 */
function startCronJobs() {
  console.log('[cron] Starting scheduled jobs...');
  
  // Abandoned cart reminders
  if (ABANDONED_CART_INTERVAL > 0) {
    abandonedCartTimer = setInterval(async () => {
      try {
        console.log('[cron] Running abandoned cart job...');
        await sendAbandonedCartReminders({ hoursOld: ABANDONED_CART_HOURS_OLD });
      } catch (err) {
        console.error('[cron] Abandoned cart job error:', err.message);
      }
    }, ABANDONED_CART_INTERVAL);
    
    console.log(`[cron] Abandoned cart job scheduled (every ${ABANDONED_CART_INTERVAL / 1000 / 60} minutes)`);
  }

  // Sale announcements
  if (SALE_ANNOUNCEMENT_INTERVAL > 0) {
    saleAnnouncementTimer = setInterval(async () => {
      try {
        console.log('[cron] Running sale announcement job...');
        await sendSaleAnnouncements();
      } catch (err) {
        console.error('[cron] Sale announcement job error:', err.message);
      }
    }, SALE_ANNOUNCEMENT_INTERVAL);
    
    console.log(`[cron] Sale announcement job scheduled (every ${SALE_ANNOUNCEMENT_INTERVAL / 1000 / 60} minutes)`);
  }

  // Run initial jobs on startup (with a small delay to let server warm up)
  setTimeout(async () => {
    try {
      await sendAbandonedCartReminders({ hoursOld: ABANDONED_CART_HOURS_OLD });
    } catch (err) {
      console.error('[cron] Initial abandoned cart job error:', err.message);
    }
  }, 5000);

  setTimeout(async () => {
    try {
      await sendSaleAnnouncements();
    } catch (err) {
      console.error('[cron] Initial sale announcement job error:', err.message);
    }
  }, 10000);
}

/**
 * Stop all cron jobs
 */
function stopCronJobs() {
  if (abandonedCartTimer) {
    clearInterval(abandonedCartTimer);
    abandonedCartTimer = null;
  }
  if (saleAnnouncementTimer) {
    clearInterval(saleAnnouncementTimer);
    saleAnnouncementTimer = null;
  }
  console.log('[cron] All jobs stopped');
}

module.exports = {
  startCronJobs,
  stopCronJobs,
};
