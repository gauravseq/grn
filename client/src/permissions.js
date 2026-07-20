// Mirror of server/permissions.js — used only to hide/disable UI. The server is
// the real gate; keep FULL/MATRIX identical to the server's.
// Each area packs a cumulative level in the low bits (1 view · 2 edit · 3 add)
// plus a separate DELETE bit (value 4). So 3 = add without delete, 7 = both.
export const FULL = { grn: 15, reports: 1, items: 7, racks: 7, vendors: 7, users: 7 };
// "Mark purchased" (bit 8) belongs to the purchase role by default.
export const MATRIX = {
  purchase: { grn: 15, reports: 1, items: 7, racks: 7, vendors: 7, users: 0 },
  dock:     { grn: 7,  reports: 1, items: 1, racks: 1, vendors: 1, users: 0 },
};
export const LEVEL = { view: 1, edit: 2, add: 3 };
export const DEL = 4;
export const PUR = 8;

// The six areas the app gates, in display order. `level` is the top cumulative
// tier the area supports (reports is view-only); `del` = whether Delete applies.
export const AREAS = [
  { key: 'grn', label: 'GRN', hint: 'Create, receive and edit goods-received notes', level: 3, del: true, pur: true },
  { key: 'reports', label: 'Reports & export', hint: 'View reports and export to Excel', level: 1, del: false },
  { key: 'items', label: 'Master items', hint: 'The product / particulars catalog', level: 3, del: true },
  { key: 'vendors', label: 'Vendors', hint: 'The vendor list', level: 3, del: true },
  { key: 'racks', label: 'Racks', hint: 'The rack / bin list', level: 3, del: true },
  { key: 'users', label: 'Users & permissions', hint: 'Manage team members and their access', level: 3, del: true },
];

// Cumulative columns (a user at level N has every tier <= N). Delete is a
// separate, independent column handled on its own in the grid.
export const TIERS = [
  { level: 1, label: 'View' },
  { level: 2, label: 'Edit' },
  { level: 3, label: 'Add' },
];

export function roleDefault(role) {
  return role === 'admin' ? { ...FULL } : { ...(MATRIX[role] || {}) };
}

// can(me, 'grn', 'edit') / can(me, 'grn', 'delete') — me is the logged-in user.
export function can(me, area, level) {
  if (!me) return false;
  const p = me.role === 'admin' ? FULL : (me.perms || MATRIX[me.role] || {});
  const v = p[area] || 0;
  if (level === 'delete') return (v & DEL) !== 0;
  if (level === 'purchase') return (v & PUR) !== 0;
  const need = typeof level === 'number' ? level : (LEVEL[level] || 1);
  return (v & 3) >= need;
}
