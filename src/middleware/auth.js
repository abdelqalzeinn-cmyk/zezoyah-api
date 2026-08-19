/**
 * middleware/auth.js — JWT verification middleware
 *
 * Reads the `zezoyah_token` httpOnly cookie. If present and valid, attaches
 * req.user = { id, email }. Does NOT reject unauthenticated requests — routes
 * that require auth should check `if (!req.user) return res.status(401)...`.
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.zezoyah_token;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email };
  } catch (err) {
    req.user = null;
  }
  next();
}

/**
 * Require authentication — returns 401 if not logged in.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Issue a JWT and return the cookie options appropriate for the environment.
 */
function issueAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: '7d',
  });

  const isLocalDev = isLocalhostOrigin();
  const cookieOptions = {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    sameSite: isLocalDev ? 'lax' : 'none',
    secure: isLocalDev ? false : true,
  };

  res.cookie('zezoyah_token', token, cookieOptions);
  return token;
}

function clearAuthCookie(res) {
  const isLocalDev = isLocalhostOrigin();
  res.clearCookie('zezoyah_token', {
    httpOnly: true,
    path: '/',
    sameSite: isLocalDev ? 'lax' : 'none',
    secure: isLocalDev ? false : true,
  });
}

function isLocalhostOrigin() {
  const origins = process.env.FRONTEND_ORIGIN || '';
  return origins
    .split(',')
    .map((o) => o.trim())
    .some((o) => o.includes('localhost') || o.includes('127.0.0.1'));
}

module.exports = { authMiddleware, requireAuth, issueAuthCookie, clearAuthCookie, JWT_SECRET };
