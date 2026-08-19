/**
 * routes/auth.js — Authentication routes
 *
 * POST /api/auth/register — { email, password, hcaptchaToken } → creates user, issues JWT cookie
 * POST /api/auth/login    — { email, password, hcaptchaToken } → verifies password, issues JWT cookie
 * POST /api/auth/logout   — clears JWT cookie
 * GET  /api/auth/me       — returns current user from JWT cookie
 *
 * All auth write routes require a valid hCaptcha token (server-verified).
 * On login, guest cart (identified by zezoyah_cart_id cookie) is merged into user's cart.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authMiddleware, requireAuth, issueAuthCookie, clearAuthCookie } = require('../middleware/auth');
const { verifyHcaptcha } = require('../middleware/hcaptcha');
const { mergeGuestCart } = require('./cart-helpers');

const router = express.Router();

// All routes use authMiddleware (attaches req.user if token present)
router.use(authMiddleware);

/**
 * GET /api/auth/me
 * Returns the current user if authenticated, 401 otherwise.
 */
router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: { id: req.user.id, email: req.user.email } });
});

/**
 * POST /api/auth/register
 * Body: { email, password, hcaptchaToken }
 */
router.post('/register', verifyHcaptcha, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(
      email.toLowerCase(),
      passwordHash
    );
    const user = { id: result.lastInsertRowid, email: email.toLowerCase() };

    issueAuthCookie(res, user);

    // Merge guest cart into new user cart
    if (req.cookies && req.cookies.zezoyah_cart_id) {
      mergeGuestCart(req.cookies.zezoyah_cart_id, user.id);
    }

    res.status(201).json({ user, message: 'Account created successfully' });
  } catch (err) {
    console.error('[auth/register] Error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password, hcaptchaToken }
 */
router.post('/login', verifyHcaptcha, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(
      email.toLowerCase()
    );
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const safeUser = { id: user.id, email: user.email };
    issueAuthCookie(res, safeUser);

    // Merge guest cart into user cart
    if (req.cookies && req.cookies.zezoyah_cart_id) {
      mergeGuestCart(req.cookies.zezoyah_cart_id, user.id);
    }

    res.json({ user: safeUser, message: 'Logged in successfully' });
  } catch (err) {
    console.error('[auth/login] Error:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
