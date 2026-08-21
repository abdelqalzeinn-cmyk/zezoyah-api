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

  // Frontend and backend are always different origins (different ports in
  // dev, different domains in prod), which browsers treat as cross-site.
  // Cross-site cookies REQUIRE SameSite=None + Secure — SameSite=Lax is
  // silently dropped on cross-origin fetch/XHR, which broke logged-in
  // sessions from persisting. `localhost` counts as a secure context even
  // over plain HTTP, so Secure:true is safe in dev too.
  const cookieOptions = {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    sameSite: 'none',
    secure: true,
  };

  res.cookie('zezoyah_token', token, cookieOptions);
  return token;
}

function clearAuthCookie(res) {
  res.clearCookie('zezoyah_token', {
    httpOnly: true,
    path: '/',
    sameSite: 'none',
    secure: true,
  });
}

module.exports = { authMiddleware, requireAuth, issueAuthCookie, clearAuthCookie, JWT_SECRET };
