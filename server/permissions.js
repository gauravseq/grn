// Role-based permissions with optional per-user overrides. For each area a user
// has a level:
//   0 none · 1 view · 2 edit · 3 add-delete   (add-delete ⊇ edit ⊇ view)
// Every user starts from their role's default matrix (MATRIX / FULL below). An
// admin can then override individual areas per user (stored on User.perms); the
// override is layered on top of the role default. Admin is always full and can
// never be locked out. Keep MATRIX identical to client/src/permissions.js.
const AREAS = ['grn', 'reports', 'items', 'racks', 'vendors', 'users'];
const LEVEL = { view: 1, edit: 2, add: 3 };
const FULL = { grn: 3, reports: 1, items: 3, racks: 3, vendors: 3, users: 3 };

const MATRIX = {
  purchase: { grn: 3, reports: 1, items: 3, racks: 3, vendors: 3, users: 0 },
  dock:     { grn: 3, reports: 1, items: 1, racks: 1, vendors: 1, users: 0 },
};

// The default level map a role gets before any per-user override.
function roleDefault(role) { return role === 'admin' ? { ...FULL } : { ...(MATRIX[role] || {}) }; }

// Keep only known areas, coerce each to an integer clamped to 0..3.
function sanitize(perms) {
  const out = {};
  const src = perms && typeof perms.toObject === 'function' ? perms.toObject() : perms;
  if (src && typeof src === 'object') {
    for (const a of AREAS) {
      const raw = src[a];
      if (raw === undefined || raw === null || raw === '') continue;
      let v = Math.round(Number(raw));
      if (!Number.isFinite(v)) continue;
      out[a] = Math.max(0, Math.min(3, v));
    }
  }
  return out;
}

// The effective level map for a user object ({ role, perms }). Admin is always
// full; everyone else is their role default with per-user overrides applied.
function effectivePerms(user) {
  if (!user) return {};
  if (user.role === 'admin') return { ...FULL };
  return { ...roleDefault(user.role), ...sanitize(user.perms) };
}

// Back-compat: role default only (no per-user override).
function permsFor(role) { return roleDefault(role); }

function need(level) { return typeof level === 'number' ? level : (LEVEL[level] || 1); }
function canPerms(perms, area, level) { return ((perms && perms[area]) || 0) >= need(level); }
function can(role, area, level) { return canPerms(roleDefault(role), area, level); }

// Express middleware: block the request unless the caller's effective perms
// (baked into their JWT at login) meet the required level for the area.
function perm(area, level) {
  return (req, res, next) => {
    const perms = (req.user && req.user.perms) || (req.user && roleDefault(req.user.role)) || {};
    return canPerms(perms, area, level)
      ? next()
      : res.status(403).json({ error: 'You do not have permission for this.' });
  };
}

module.exports = { AREAS, LEVEL, FULL, MATRIX, roleDefault, sanitize, effectivePerms, permsFor, canPerms, can, perm };
