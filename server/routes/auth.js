const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sign, authRequired, role } = require('../middleware/auth');
const { permsFor, perm } = require('../permissions');

const router = express.Router();

const MIN_PASSWORD = 8;

// Lightweight in-memory login throttle (per IP + username) to blunt brute-force
// attempts. Zero dependencies; state is per-process, which is fine for the
// single-node deployments this app targets.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();
function loginKey(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  return ip + '|' + ((req.body && req.body.username) || '').trim().toLowerCase();
}
function tooManyAttempts(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_ATTEMPTS;
}
function noteFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else rec.count++;
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Enter username and password.' });
  const key = loginKey(req);
  if (tooManyAttempts(key)) return res.status(429).json({ error: 'Too many login attempts. Wait a few minutes and try again.' });
  const user = await User.findOne({ username: username.trim() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    noteFailure(key);
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  attempts.delete(key);
  res.json({ token: sign(user), user: { id: user._id, username: user.username, name: user.fullName, role: user.role, perms: permsFor(user.role) } });
});

router.get('/me', authRequired, (req, res) => res.json({ user: req.user }));

router.post('/password', authRequired, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < MIN_PASSWORD) return res.status(400).json({ error: `New password too short (min ${MIN_PASSWORD} characters).` });
  const user = await User.findById(req.user.id);
  if (!user || !(await bcrypt.compare(current || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Current password is wrong.' });
  }
  user.passwordHash = await bcrypt.hash(next, 10);
  await user.save();
  res.json({ ok: true });
});

router.post('/register', authRequired, perm('users', 'add'), async (req, res) => {
  const { username, password, full_name, role: r } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password too short (min ${MIN_PASSWORD} characters).` });
  if (!['admin', 'purchase', 'dock'].includes(r)) return res.status(400).json({ error: 'Invalid role.' });
  const exists = await User.findOne({ username: username.trim() });
  if (exists) return res.status(409).json({ error: 'That username is taken.' });
  const user = await User.create({
    username: username.trim(),
    passwordHash: await bcrypt.hash(password, 10),
    fullName: (full_name || '').trim(),
    role: r,
  });
  res.json({ user: { id: user._id, username: user.username, full_name: user.fullName, role: user.role } });
});

module.exports = router;
