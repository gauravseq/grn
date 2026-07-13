const express = require('express');
const User = require('../models/User');
const { authRequired } = require('../middleware/auth');
const { perm } = require('../permissions');

const router = express.Router();
router.use(authRequired);

router.get('/', perm('users', 'view'), async (req, res) => {
  const users = await User.find({}, 'username fullName role createdAt').sort({ createdAt: 1 }).lean();
  res.json(users.map((u) => ({ id: u._id.toString(), username: u.username, full_name: u.fullName, role: u.role, created_at: u.createdAt })));
});

router.delete('/:id', perm('users', 'add'), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  await User.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
