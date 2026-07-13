const { Schema, model } = require('mongoose');
const VendorSchema = new Schema({ name: { type: String, required: true, unique: true, trim: true } }, { timestamps: true });
module.exports = model('Vendor', VendorSchema);
