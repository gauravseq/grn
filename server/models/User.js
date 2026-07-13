const { Schema, model } = require('mongoose');
const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'purchase', 'dock'], default: 'dock' },
}, { timestamps: true });
module.exports = model('User', UserSchema);
