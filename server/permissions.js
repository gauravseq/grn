// Role-based permissions with optional per-user overrides. Each area stores one
// number that packs two independent things:
//   • a cumulative level in the low bits: 0 none · 1 view · 2 edit · 3 add
//   • a separate DELETE flag (bit value 4) — granted on its own, so a user can
//     have Add WITHOUT Delete (or vice-versa).
// So a stored value V means: level = (V & 3), canDelete = (V & 4) !== 0.
//   e.g. 3 = add (no delete) · 4 = view+delete · 7 = add+delete (full).
// Every user starts from their role default (MATRIX / FULL); an admin can layer
// a per-user override on top (User.perms). Admin is always full. Keep this file
// in sync with client/src/permissions.js.
const AREAS = ['grn', 'reports', 'items', 'racks', 'vendors', 'users'];
const LEVEL = { view: 1, edit: 2, add: 3 };
const DEL = 4; // the delete bit
const PUR = 8; // the "mark purchased" bit (only meaningful on the grn area)
const FULL = { grn: 15, reports: 1, items: 7, racks: 7, vendors: 7, users: 7 };

// Marking a received note purchased belongs to the PURCHASE role by default
// (grn 15 = add + delete + purchase); dock gets 7 (add + delete, no purchase).
// An admin can grant or revoke it per user from the Permissions grid.
const MATRIX = {
  purchase: { grn: 15, reports: 1, items: 7, racks: 7, vendors: 7, users: 0 },
  dock:     { grn: 7,  reports: 1, items: 1, racks: 1, vendors: 1, users: 0 },
};

// The default value map a role gets before any per-user override.
function roleDefault(role) { return role === 'admin' ? { ...FULL } : { ...(MATRIX[role] || {}) }; }

// Keep only known areas, coerce each to an integer clamped to 0..7.
function sanitize(perms) {
  const out = {};
  const src = perms && typeof perms.toObject === 'function' ? perms.toObject() : perms;
  if (src && typeof src === 'object') {
    for (const a of AREAS) {
      const raw = src[a];
      if (raw === undefined || raw === null || raw === '') continue;
      let v = Math.round(Number(raw));
      if (!Number.isFinite(v)) continue;
      out[a] = Math.max(0, Math.min(15, v));
    }
  }
  return out;
}

// The effective value map for a user object ({ role, perms }). Admin is always
// full; everyone else is their role default with per-user overrides applied.
function effectivePerms(user) {
  if (!user) return {};
  if (user.role === 'admin') return { ...FULL };
  return { ...roleDefault(user.role), ...sanitize(user.perms) };
}

// Back-compat: role default only (no per-user override).
function permsFor(role) { return roleDefault(role); }

function need(level) { return typeof level === 'number' ? level : (LEVEL[level] || 1); }
// can(perms, area, 'delete') checks the delete bit; otherwise the cumulative level.
function canPerms(perms, area, level) {
  const v = (perms && perms[area]) || 0;
  if (level === 'delete') return (v & DEL) !== 0;
  if (level === 'purchase') return (v & PUR) !== 0;
  return (v & 3) >= need(level);
}
function can(role, area, level) { return canPerms(roleDefault(role), area, level); }

// Express middleware: block the request unless the caller's effective perms
// (re-hydrated onto req.user by authRequired) meet the requirement for the area.
function perm(area, level) {
  return (req, res, next) => {
    const perms = (req.user && req.user.perms) || (req.user && roleDefault(req.user.role)) || {};
    return canPerms(perms, area, level)
      ? next()
      : res.status(403).json({ error: 'You do not have permission for this.' });
  };
}

module.exports = { AREAS, LEVEL, DEL, PUR, FULL, MATRIX, roleDefault, sanitize, effectivePerms, permsFor, canPerms, can, perm };
