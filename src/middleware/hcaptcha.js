/**
 * middleware/hcaptcha.js — Server-side hCaptcha verification
 *
 * Verifies the hCaptcha token from the request body by POSTing to
 * https://hcaptcha.com/siteverify with the HCAPTCHA_SECRET env var.
 * Rejects with 400 if verification fails or token is missing.
 *
 * CRITICAL: Never trust client-side hCaptcha state alone. Always verify
 * server-side.
 */
const https = require('https');

const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET || '';

/**
 * Verify hCaptcha token. Expects req.body.hcaptchaToken.
 * If HCAPTCHA_SECRET is not set (dev mode), skips verification with a warning.
 */
async function verifyHcaptcha(req, res, next) {
  const token = req.body && req.body.hcaptchaToken;

  if (!HCAPTCHA_SECRET) {
    console.warn('[hcaptcha] HCAPTCHA_SECRET not set — skipping verification (DEV MODE ONLY)');
    return next();
  }

  if (!token) {
    return res.status(400).json({ error: 'Captcha token is required' });
  }

  try {
    const isValid = await verifyToken(token, req.ip);
    if (!isValid) {
      return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    }
    next();
  } catch (err) {
    console.error('[hcaptcha] Verification error:', err.message);
    return res.status(500).json({ error: 'Captcha verification service unavailable' });
  }
}

function verifyToken(token, remoteip) {
  return new Promise((resolve, reject) => {
    const postData = `secret=${encodeURIComponent(HCAPTCHA_SECRET)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(remoteip || '')}`;

    const options = {
      hostname: 'hcaptcha.com',
      path: '/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success === true);
        } catch (e) {
          reject(new Error('Invalid response from hCaptcha'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

module.exports = { verifyHcaptcha };
