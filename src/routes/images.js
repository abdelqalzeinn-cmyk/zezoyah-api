/**
 * routes/images.js — Image streaming route
 *
 * GET /api/images/:filename
 *
 * - Validates :filename against strict pattern (^img_\d{4}\.(jpg|jpeg|png|webp|gif)$)
 *   to prevent path traversal or arbitrary file access.
 * - Streams the file from storage abstraction (local disk or S3).
 * - Sets correct Content-Type and immutable caching headers.
 */
const express = require('express');
const { getImageStream, guessContentType } = require('../storage');

const router = express.Router();

const FILENAME_PATTERN = /^img_\d{4}\.(jpg|jpeg|png|webp|gif)$/i;

router.get('/:filename', async (req, res) => {
  const { filename } = req.params;

  // Strict validation — reject anything that doesn't match the pattern
  if (!FILENAME_PATTERN.test(filename)) {
    return res.status(400).json({ error: 'Invalid image filename' });
  }

  try {
    const { stream, contentType, contentLength } = await getImageStream(filename);

    // Filenames are content-stable (sequential, fixed) → immutable caching
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Handle stream errors (e.g., file deleted mid-read)
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read image' });
      }
    });

    stream.pipe(res);
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.message.includes('NoSuchKey') || err.message.includes('NotFound')) {
      return res.status(404).json({ error: 'Image not found' });
    }
    console.error('[images] Error streaming', filename, ':', err.message);
    return res.status(500).json({ error: 'Failed to serve image' });
  }
});

module.exports = router;
