// Mirror of server/permissions.js — used only to hide/disable UI. The server is
// the real gate; keep this MATRIX identical to the server's.
// Levels per area: 0 none · 1 view · 2 edit · 3 add-delete (add ⊇ edit ⊇ view).
export const FULL = { grn: 3, reports: 1, items: 3, racks: 3, vendors: 3, users: 3 };
export const MATRIX = {
  purchase: { grn: 3, reports: 1, items: 3, racks: 3, vendors: 3, users: 0 },
  dock:     { grn: 3, reports: 1, items: 1, racks: 1, vendors: 1, users: 0 },
};
export const LEVEL = { view: 1, edit: 2, add: 3 };

// The six areas the app gates, in display order, with the label + description
// shown in the permissions grid and the top level each area actually supports.
export const AREAS = [
  { key: 'grn', label: 'GRN', hint: 'Create, receive and edit goods-received notes', max: 3 },
  { key: 'reports', label: 'Reports & export', hint: 'View reports and export to Excel', max: 1 },
  { key: 'items', label: 'Master items', hint: 'The product / particulars catalog', max: 3 },
  { key: 'vendors', label: 'Vendors', hint: 'The vendor list', max: 3 },
  { key: 'racks', label: 'Racks', hint: 'The rack / bin list', max: 3 },
  { key: 'users', label: 'Users & permissions', hint: 'Manage team members and their access', max: 3 },
];

// Column tiers shown in the grid. A user at level N has every tier <= N.
export const TIERS = [
  { level: 1, label: 'View' },
  { level: 2, label: 'Edit' },
  { level: 3, label: 'Add / Delete' },
];

export function roleDefault(role) {
  return role === 'admin' ? { ...FULL } : { ...(MATRIX[role] || {}) };
}

// can(me, 'grn', 'edit') — me is the logged-in user object (has role, maybe perms).
export function can(me, area, level) {
  if (!me) return false;
  const need = typeof level === 'number' ? level : (LEVEL[level] || 1);
  if (me.role === 'admin') return (FULL[area] || 0) >= need;
  const p = me.perms || MATRIX[me.role] || {};
  return (p[area] || 0) >= need;
}
