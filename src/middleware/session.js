/**
 * middleware/session.js — Anonymous session identity
 *
 * Assigns every visitor (logged in or guest) a random, unguessable
 * `zezoyah_sid` httpOnly cookie on first request, mirroring the existing
 * guest-cart-cookie pattern in routes/cart-helpers.js.
 *
 * This is NOT an auth mechanism — it doesn't identify who the visitor is,
 * only that repeat requests are coming from the same browser session. It
 * exists so image signatures (routes/images.js) can be bound to "this
 * specific browser," not just "anyone who has the URL" — a signed image
 * URL copied out of this session (into a fresh incognito tab, a different
 * browser, or shared with someone else) won't carry a matching session
 * cookie and will fail verification.
 */
const { v4: uuidv4 } = require('uuid');

const SID_COOKIE = 'zezoyah_sid';

function sessionMiddleware(req, res, next) {
  let sid = req.cookies && req.cookies[SID_COOKIE];

  if (!sid) {
    sid = uuidv4();
    // Same cross-origin cookie requirements as the auth/cart cookies:
    // frontend and backend are different origins even in local dev, so
    // this needs SameSite=None + Secure to survive fetch/XHR and <img>
    // requests. `localhost` counts as a secure context over plain HTTP.
    res.cookie(SID_COOKIE, sid, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
      sameSite: 'none',
      secure: true,
    });
  }

  req.sessionId = sid;
  next();
}

module.exports = { sessionMiddleware, SID_COOKIE };