#!/usr/bin/env node
/**
 * scripts/trigger-abandoned.js — Manually trigger abandoned cart job
 * 
 * Usage: node scripts/trigger-abandoned.js [hoursOld]
 */

const { sendAbandonedCartReminders } = require('../src/jobs/abandoned-cart-job');

async function main() {
  const hoursOld = parseInt(process.argv[2] || '2', 10);
  console.log(`Running abandoned cart job (carts older than ${hoursOld} hours)...`);
  
  const result = await sendAbandonedCartReminders({ hoursOld });
  console.log('Result:', result);
}

main().catch(console.error);
