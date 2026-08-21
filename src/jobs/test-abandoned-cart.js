// Force load .env from the root directory
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { db } = require('../db');
const { sendAbandonedCartReminders } = require('./abandoned-cart-job');

console.log('--- DIAGNOSTICS ---');
console.log('EMAIL_PROVIDER:', process.env.EMAIL_PROVIDER);
console.log('API Key configured:', !!(process.env.BREVO_API_KEY || process.env.SMTP_PASS));

// Check how many carts are eligible in the DB
const cartCheck = db.prepare(`
  SELECT c.id, c.user_id, u.email 
  FROM carts c 
  JOIN cart_items ci ON ci.cart_id = c.id 
  LEFT JOIN users u ON u.id = c.user_id
`).all();
console.log('Found carts in DB:', cartCheck);
console.log('-------------------\n');

// Trigger send bypassing time and cooldown checks
sendAbandonedCartReminders({
  hoursOld: 0,
  maxReminders: 99,
  reminderCooldownHours: 0
})
.then(result => {
  console.log('Result:', result);
  process.exit(0);
})
.catch(err => {
  console.error('Error:', err);
  process.exit(1);
});