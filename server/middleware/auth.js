const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { effectivePerms } = require('../permissions');
const SECRET = () => process.env.JWT_SECRET || 'change-me';

function sign(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role, username: user.username, name: user.fullName || '', perms: effectivePerms(user) },
    SECRET(), { expiresIn: '12h' }
  );
}
// The JWT proves identity; it does NOT freeze access. On every request we
// re-hydrate the caller's role + permissions from the DB, so an admin's
// permission change (or an account deletion) takes effect immediately instead
// of lingering until the old token expires.
async function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  let decoded;
  try { decoded = jwt.verify(token, SECRET()); }
  catch (e) { return res.status(401).json({ error: 'Session expired. Log in again.' }); }
  try {
    const u = await User.findById(decoded.id).lean();
    if (!u) return res.status(401).json({ error: 'Your account no longer exists. Log in again.' });
    req.user = { id: u._id.toString(), username: u.username, name: u.fullName || '', role: u.role, perms: effectivePerms(u) };
  } catch (e) {
    // DB hiccup: fall back to the token's snapshot rather than locking everyone out.
    req.user = decoded;
  }
  next();
}
function role(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this.' });
    next();
  };
}
module.exports = { sign, authRequired, role };
