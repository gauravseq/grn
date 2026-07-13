// Mirror of server/permissions.js — used only to hide/disable UI. The server is
// the real gate; keep this MATRIX identical to the server's.
// Levels per area: 0 none · 1 view · 2 edit · 3 add-delete (add ⊇ edit ⊇ view).
const FULL = { grn: 3, reports: 1, items: 3, racks: 3, vendors: 3, users: 3 };
const MATRIX = {
  purchase: { grn: 3, reports: 1, items: 3, racks: 3, vendors: 3, users: 0 },
  dock:     { grn: 3, reports: 1, items: 1, racks: 1, vendors: 1, users: 0 },
};
const LEVEL = { view: 1, edit: 2, add: 3 };

// can(me, 'grn', 'edit') — me is the logged-in user object (has role, maybe perms).
export function can(me, area, level) {
  if (!me) return false;
  const need = typeof level === 'number' ? level : (LEVEL[level] || 1);
  if (me.role === 'admin') return (FULL[area] || 0) >= need;
  const p = me.perms || MATRIX[me.role] || {};
  return (p[area] || 0) >= need;
}
