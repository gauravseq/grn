const { Schema, model } = require('mongoose');
const ProductSchema = new Schema({
  name: { type: String, required: true },
  normName: { type: String, required: true, unique: true },
  // An item can live in several racks and come from several vendors. The first
  // entry in each list is treated as the primary (used to auto-fill on receipt).
  racks: { type: [String], default: [] },
  vendors: { type: [String], default: [] },
  aliases: { type: [String], default: [] },
  unit: { type: String, default: '' },
  // Extra descriptive columns carried from the master sheet (informational —
  // stored + returned by the API + round-tripped on export).
  vendorName: { type: String, default: '' },
  pid: { type: String, default: '' },
  pdid: { type: String, default: '' },
  timesUsed: { type: Number, default: 0 },
}, { timestamps: true });
module.exports = model('Product', ProductSchema);
