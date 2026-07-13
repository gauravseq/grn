const jwt = require('jsonwebtoken');
const { permsFor } = require('../permissions');
const SECRET = () => process.env.JWT_SECRET || 'change-me';

function sign(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role, username: user.username, name: user.fullName || '', perms: permsFor(user.role) },
    SECRET(), { expiresIn: '12h' }
  );
}
function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try { req.user = jwt.verify(token, SECRET()); next(); }
  catch (e) { res.status(401).json({ error: 'Session expired. Log in again.' }); }
}
function role(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this.' });
    next();
  };
}
module.exports = { sign, authRequired, role };
