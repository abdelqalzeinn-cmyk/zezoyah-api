#!/usr/bin/env node
/**
 * scripts/test-email.js — Test email configuration
 * 
 * Usage: node scripts/test-email.js your@email.com
 * 
 * Sends a test email to verify your email configuration is working.
 */

const { sendEmail, buildEmailTemplate } = require('../src/services/email-service');

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.log('Usage: node scripts/test-email.js your@email.com');
    console.log('');
    console.log('Environment variables needed:');
    console.log('  EMAIL_PROVIDER: console (default), smtp, or sendgrid');
    console.log('  EMAIL_FROM: sender email (e.g. "Zezoyah <noreply@zezoyah.com>")');
    console.log('  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS: for SMTP');
    console.log('  SENDGRID_API_KEY: for SendGrid');
    process.exit(1);
  }

  console.log(`Sending test email to ${to}...`);
  console.log(`Provider: ${process.env.EMAIL_PROVIDER || 'console'}`);

  const html = buildEmailTemplate({
    title: 'Test Email',
    preheader: 'This is a test email from Zezoyah',
    content: `
      <h2 style="color:#1e1a16;margin:0 0 16px;">Email Test Successful! 🎉</h2>
      <p style="color:rgba(30,26,22,0.75);line-height:1.6;">If you're receiving this, your email configuration is working correctly.</p>
      <p style="color:rgba(30,26,22,0.75);line-height:1.6;">You can now send abandoned cart reminders and sale announcements.</p>
    `,
    ctaText: 'Visit Zezoyah',
    ctaUrl: process.env.FRONTEND_URL || 'https://zezoyah.com',
  });

  const result = await sendEmail({
    to,
    subject: 'Zezoyah Email Test',
    text: 'Email test from Zezoyah. If you receive this, your configuration is working!',
    html,
  });

  if (result.success) {
    console.log('✓ Email sent successfully!');
    console.log(`  Message ID: ${result.messageId}`);
    if (result.messageId === 'console-logged') {
      console.log('  (Email was logged to logs/ directory — set EMAIL_PROVIDER=smtp or sendgrid to send real emails)');
    }
  } else {
    console.log('✗ Email failed:', result.error);
  }
}

main().catch(console.error);
