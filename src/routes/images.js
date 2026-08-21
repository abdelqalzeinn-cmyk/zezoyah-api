/**
 * routes/images.js — Image streaming route with signed URL protection
 * 
 * GET /api/images/:filename
 * 
 * - Validates :filename against strict pattern to prevent path traversal
 * - Streams the file from storage abstraction (local disk or S3)
 * - Sets correct Content-Type and caching headers
 * - Requires valid signed URL (expires after 1 hour), bound to the
 *   requesting browser's session (zezoyah_sid cookie, see
 *   middleware/session.js). A signature minted for one session will not
 *   verify for a different session -- so a URL copied out of the page
 *   (into a fresh incognito tab, a different browser, or shared with
 *   someone else) fails even before the 1-hour expiry, because the new
 *   request won't carry the matching session cookie.
 */

const express = require('express');
const crypto = require('crypto');
const { getImageStream } = require('../storage');

const router = express.Router();

const FILENAME_PATTERN = /^img_\d{4}\.(jpg|jpeg|png|webp|gif)$/i;

// Generate a signed URL for an image, bound to a specific session ID.
function generateImageSignature(filename, sessionId) {
  const secret = process.env.IMAGE_SECRET || 'zezoyah-image-secret-change-in-production';
  const timestamp = Math.floor(Date.now() / 1000);
  const data = `${filename}:${timestamp}:${sessionId}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  return { signature, timestamp };
}

// Verify image signature against the requesting session's ID.
function verifyImageSignature(filename, signature, timestamp, sessionId) {
  const secret = process.env.IMAGE_SECRET || 'zezoyah-image-secret-change-in-production';

  // Check if signature is expired (1 hour)
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 3600; // 1 hour
  if (now - timestamp > maxAge) {
    return false;
  }

  const data = `${filename}:${timestamp}:${sessionId}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');

  // Lengths must match before timingSafeEqual (it throws on mismatched
  // buffer lengths rather than returning false).
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// Generate signed URL for frontend. Requires a session cookie -- the
// caller must be a real browser that has already received zezoyah_sid
// from the session middleware (any prior request to this API sets it).
router.get('/sign/:filename', (req, res) => {
  const { filename } = req.params;

  if (!FILENAME_PATTERN.test(filename)) {
    return res.status(400).json({ error: 'Invalid image filename' });
  }

  if (!req.sessionId) {
    // Should not happen -- sessionMiddleware runs on every request and
    // always sets req.sessionId -- but fail closed if it's somehow absent.
    return res.status(403).json({ error: 'No session' });
  }

  const { signature, timestamp } = generateImageSignature(filename, req.sessionId);
  res.json({ filename, signature, timestamp });
});

// Serve image with signature + session verification
router.get('/:filename', async (req, res) => {
  const { filename } = req.params;
  const { sig, ts } = req.query;

  // Strict validation — reject anything that doesn't match the pattern
  if (!FILENAME_PATTERN.test(filename)) {
    return res.status(400).json({ error: 'Invalid image filename' });
  }

  // Signature verification is skipped unless explicitly enforced.
  // Production deploys should set IMAGE_SIGNING_ENFORCED=true (or
  // NODE_ENV=production) so unsigned/foreign-session image URLs are
  // rejected with 403. Locally, set IMAGE_SIGNING_ENFORCED=true in .env
  // if you want to verify the frontend's signing logic without a full
  // prod deploy.
  const isDev = !(
    process.env.IMAGE_SIGNING_ENFORCED === 'true' || process.env.NODE_ENV === 'production'
  );

  if (!isDev) {
    if (
      !sig ||
      !ts ||
      !req.sessionId ||
      !verifyImageSignature(filename, sig, parseInt(ts, 10), req.sessionId)
    ) {
      return res.status(403).json({ error: 'Invalid or expired image signature' });
    }
  }

  try {
    const { stream, contentType, contentLength } = await getImageStream(filename);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', isDev ? 'no-cache' : 'private, max-age=3600');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read image' });
      }
    });

    stream.pipe(res);
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.message.includes('NoSuchKey')) {
      return res.status(404).json({ error: 'Image not found' });
    }
    console.error('[images] Error streaming', filename, ':', err.message);
    return res.status(500).json({ error: 'Failed to serve image' });
  }
});

module.exports = router;
