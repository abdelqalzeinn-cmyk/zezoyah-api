/**
 * index.js — Express app entrypoint
 *
 * Zezoyah backend API. Serves ONLY JSON API routes + /api/images/:filename.
 * Does NOT serve any static HTML/CSS/JS site files (frontend is a separate deployment).
 *
 * CORS: allows origins from FRONTEND_ORIGIN env var (comma-separated).
 * Cookies: httpOnly JWT, secure + sameSite:none in production, lax in localhost dev.
 */
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

// Ensure DB is initialized
const { db } = require('./db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const imageRoutes = require('./routes/images');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');

const app = express();
const PORT = process.env.PORT || 4000;

// Parse CORS origins from env (comma-separated)
const corsOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// CORS: allow frontend origin(s), credentials for cookies
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow non-browser requests (no Origin header, e.g. curl/health checks)
      if (!origin) return callback(null, true);
      if (corsOrigins.indexOf(origin) !== -1) return callback(null, true);
      return callback(new Error('CORS not allowed for origin: ' + origin));
    },
    credentials: true, // <-- CRITICAL: Allows cookies to be accepted by the backend
  })
);

app.use(express.json());
app.use(cookieParser());

// Trust proxy (needed for correct req.ip behind Render's load balancer)
app.set('trust proxy', 1);

// Request logging (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    storage_driver: require('./storage').DRIVER,
  });
});

// Serve the local uploads folder statically at /api/images
app.use('/api/images', express.static(path.join(__dirname, '../uploads')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);

// 404 for unknown /api routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes('CORS')) {
    console.warn('[CORS]', err.message);
    return res.status(403).json({ error: 'CORS policy blocked this request' });
  }
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start listening if this file is run directly (not required by import-scripts)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Zezoyah API server running on port ${PORT}`);
    console.log(`  CORS origins: ${corsOrigins.join(', ')}`);
    console.log(`  Image storage driver: ${require('./storage').DRIVER}`);
    console.log(`  Health check: http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = app;
