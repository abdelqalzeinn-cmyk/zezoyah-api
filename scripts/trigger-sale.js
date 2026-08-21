#!/usr/bin/env node
/**
 * scripts/trigger-sale.js — Manually trigger sale announcement job
 * 
 * Usage: node scripts/trigger-sale.js
 */

const { sendSaleAnnouncements } = require('../src/jobs/sale-announcement-job');

async function main() {
  console.log('Running sale announcement job...');
  const result = await sendSaleAnnouncements();
  console.log('Result:', result);
}

main().catch(console.error);
