const { Schema, model } = require('mongoose');

// Per-user permission override. Each area holds a level: 0 none · 1 view ·
// 2 edit · 3 add-delete. When `perms` is unset the user inherits their role's
// default matrix (see permissions.js); when set, these values are layered on
// top of that default. Admins are always full and ignore this field.
const PermsSchema = new Schema({
  grn: Number, reports: Number, items: Number, racks: Number, vendors: Number, users: Number,
}, { _id: false });

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'purchase', 'dock'], default: 'dock' },
  perms: { type: PermsSchema, default: undefined },
}, { timestamps: true });
module.exports = model('User', UserSchema);
