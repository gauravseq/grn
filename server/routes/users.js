const express = require('express');
const User = require('../models/User');
const { authRequired } = require('../middleware/auth');
const { perm, effectivePerms, roleDefault, sanitize, AREAS } = require('../permissions');

const router = express.Router();
router.use(authRequired);

function shape(u) {
  return {
    id: u._id.toString(),
    username: u.username,
    full_name: u.fullName,
    role: u.role,
    created_at: u.createdAt,
    perms: effectivePerms(u),           // what this user can actually do now
    custom: !!u.perms && u.role !== 'admin', // has a per-user override vs pure role default
  };
}

router.get('/', perm('users', 'view'), async (req, res) => {
  const users = await User.find({}).sort({ createdAt: 1 }).lean();
  res.json(users.map(shape));
});

// Set (or reset) a user's per-user permission override. Admin-level action.
router.patch('/:id/perms', perm('users', 'add'), async (req, res) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Admins always have full access; their permissions cannot be limited.' });

  const { reset } = req.body || {};
  let update;
  if (reset) {
    update = { $unset: { perms: 1 } };
  } else {
    const clean = sanitize((req.body || {}).perms);
    // Store only the areas that differ from the role default, so a user tracks
    // their role's baseline for any area left untouched. If nothing differs,
    // drop the override entirely so the user is back on pure role defaults.
    const base = roleDefault(user.role);
    const override = {};
    let any = false;
    for (const a of AREAS) {
      if (clean[a] !== undefined && clean[a] !== base[a]) { override[a] = clean[a]; any = true; }
    }
    update = any ? { $set: { perms: override } } : { $unset: { perms: 1 } };
  }
  await User.updateOne({ _id: user._id }, update);
  const fresh = await User.findById(user._id).lean();
  res.json(shape(fresh));
});

router.delete('/:id', perm('users', 'delete'), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  await User.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
