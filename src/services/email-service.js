/**
 * email-service.js — Email sending abstraction
 * 
 * Supports multiple providers via environment variables:
 * - SMTP (default): Use any SMTP server (Brevo, Gmail, SendGrid, Mailgun, etc.)
 * - SendGrid API: Set EMAIL_PROVIDER=sendgrid
 * - Console/log fallback: If no credentials, logs to console (dev mode)
 * 
 * Environment variables:
 *   EMAIL_PROVIDER: 'smtp' (default), 'sendgrid', 'console'
 *   EMAIL_FROM: Sender email address (e.g. 'Zezoyah <noreply@zezoyah.com>')
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS: SMTP credentials
 *   SENDGRID_API_KEY: If using SendGrid
 */

const fs = require('fs');
const path = require('path');

// Load .env file if it exists
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, skip
}

/**
 * Send an email
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} options.html - HTML body
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail({ to, subject, text, html }) {
  const provider = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
  const from = process.env.EMAIL_FROM || 'Zezoyah <noreply@zezoyah.com>';

  try {
    if (provider === 'brevo') {
      return await sendWithBrevoAPI({ to, from, subject, text, html });
    } else if (provider === 'smtp') {
      return await sendWithSMTP({ to, from, subject, text, html });
    } else {
      // Console fallback — log to file in dev
      return await sendWithConsole({ to, from, subject, text, html });
    }
  } catch (err) {
    console.error('[email] Failed to send:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send via Brevo HTTPS API (fallback when SMTP is blocked)
 * Uses port 443 which is rarely blocked
 */
async function sendWithBrevoAPI({ to, from, subject, text, html }) {
  const apiKey = process.env.SMTP_PASS || process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY or SMTP_PASS not configured');
  }

  const data = JSON.stringify({
    sender: { name: from.split('<')[0].trim(), email: from.split('<')[1]?.replace('>', '') || from },
    to: [{ email: to }],
    subject: subject,
    htmlContent: html,
    textContent: text,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = require('https').request(options, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, messageId: JSON.parse(body)?.messageId || 'sent' });
        } else {
          reject(new Error(`Brevo API error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

/**
 * Send via SMTP using a simple approach
 * Requires nodemailer to be installed
 */
async function sendWithSMTP({ to, from, subject, text, html }) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // Brevo uses STARTTLS on port 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false, // Some SMTP relays need this
      },
    });

    const info = await transporter.sendMail({ from, to, subject, text, html });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn('[email] nodemailer not installed, falling back to console');
      return sendWithConsole({ to, from, subject, text, html });
    }
    throw err;
  }
}

/**
 * Console/file fallback — logs the email instead of sending
 */
async function sendWithConsole({ to, from, subject, text, html }) {
  const logDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const logEntry = `
=== ${timestamp} ===
From: ${from}
To: ${to}
Subject: ${subject}
---
${text || html}
=================

`;

  const logFile = path.join(logDir, `emails-${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(logFile, logEntry);

  console.log(`[email] 📧 Console email logged: "${subject}" → ${to}`);
  return { success: true, messageId: 'console-logged' };
}

/**
 * Build a beautiful HTML email template
 */
function buildEmailTemplate({ title, preheader, content, ctaText, ctaUrl, unsubscribeUrl }) {
  const brandColor = '#7a3a2e';
  const bgColor = '#fdfbf7';
  const textColor = '#1e1a16';
  const mutedColor = 'rgba(30, 26, 22, 0.6)';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4ede4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;padding:20px;">
    <tr>
      <td style="background:${bgColor};border-radius:14px;overflow:hidden;box-shadow:0 4px 16px rgba(30,26,22,0.08);">
        <!-- Header -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;background:${brandColor};">
              <h1 style="margin:0;color:#fdfbf7;font-size:28px;font-weight:700;letter-spacing:-0.01em;">Zezoyah</h1>
            </td>
          </tr>
        </table>
        
        <!-- Content -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:32px;">
              ${content}
              ${ctaText && ctaUrl ? `
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px auto;">
                <tr>
                  <td style="background:${brandColor};border-radius:4px;text-align:center;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:14px 36px;color:#fdfbf7;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.04em;">${ctaText}</a>
                  </td>
                </tr>
              </table>
              ` : ''}
            </td>
          </tr>
        </table>
        
        <!-- Footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:24px 32px;background:#f3ede4;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:${mutedColor};">© 2026 Zezoyah. All rights reserved.</p>
              ${unsubscribeUrl ? `<p style="margin:0;font-size:12px;color:${mutedColor};"><a href="${unsubscribeUrl}" style="color:${brandColor};">Unsubscribe</a> from these emails</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build the abandoned cart email HTML content
 */
function buildAbandonedCartContent(items, totals, cartUrl) {
  const itemsHtml = items.slice(0, 4).map(item => {
    const price = (item.unit_price_cents / 100).toFixed(2);
    const imageHtml = item.image 
      ? `<td width="80" style="vertical-align:top;padding-right:16px;"><img src="${process.env.FRONTEND_URL || 'https://zezoyah.com'}/api/images/${item.image}" alt="${item.product_name}" width="80" height="100" style="object-fit:cover;border-radius:6px;display:block;"></td>`
      : '';
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        ${imageHtml}
        <td style="vertical-align:top;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#1e1a16;">${item.product_name}</p>
          ${item.variant_title ? `<p style="margin:0 0 4px;font-size:13px;color:rgba(30,26,22,0.6);">${item.variant_title}</p>` : ''}
          <p style="margin:0;font-size:14px;color:#7a3a2e;font-weight:700;">LE ${price} × ${item.quantity}</p>
        </td>
      </tr>
    </table>`;
  }).join('');

  const totalPrice = (totals.total_cents / 100).toFixed(2);

  return `
    <h2 style="margin:0 0 16px;font-size:22px;color:#1e1a16;font-weight:700;">You left something behind ❤</h2>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:rgba(30,26,22,0.75);">Items in your cart are waiting for you! Complete your order before they sell out.</p>
    
    <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:24px;border:1px solid rgba(30,26,22,0.08);">
      ${itemsHtml}
    </div>
    
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="border-top:1px solid rgba(30,26,22,0.1);padding-top:16px;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#1e1a16;text-align:right;">Total: <span style="color:#7a3a2e;">LE ${totalPrice}</span></p>
        </td>
      </tr>
    </table>
    
    <p style="margin:0 0 24px;font-size:14px;color:rgba(30,26,22,0.5);text-align:center;">Free shipping on orders over 2000 EGP • Easy 14-day returns</p>
  `;
}

/**
 * Build the sale announcement email HTML content
 */
function buildSaleContent(sale) {
  const discountBadge = sale.discount_percent 
    ? `<span style="display:inline-block;background:#7a3a2e;color:#fff;font-size:14px;font-weight:700;padding:6px 14px;border-radius:2px;margin-bottom:16px;">${sale.discount_percent}% OFF</span>` 
    : '';

  return `
    ${discountBadge}
    <h2 style="margin:0 0 16px;font-size:24px;color:#1e1a16;font-weight:700;">${sale.title || 'Big Sale at Zezoyah! 🎉'}</h2>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:rgba(30,26,22,0.75);">${sale.message || 'Our biggest sale of the season is here. Don\'t miss out on premium fashion at unbeatable prices.'}</p>
    
    ${sale.product_slugs && sale.product_slugs.length ? `
    <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#1e1a16;">Featured deals:</p>
    <p style="margin:0 0 24px;font-size:14px;color:rgba(30,26,22,0.7);">${sale.product_slugs.length} items on sale — shop them before they're gone!</p>
    ` : ''}
    
    <p style="margin:0 0 24px;font-size:14px;color:rgba(30,26,22,0.5);text-align:center;">Limited time offer • While stocks last</p>
  `;
}

module.exports = {
  sendEmail,
  buildEmailTemplate,
  buildAbandonedCartContent,
  buildSaleContent,
};
