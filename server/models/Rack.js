const { Schema, model } = require('mongoose');
// Global pool of bin/rack locations. Any item can be received into any rack;
// an item's own history of racks is tracked separately on the Product.
const RackSchema = new Schema({ name: { type: String, required: true, unique: true, trim: true } }, { timestamps: true });
module.exports = model('Rack', RackSchema);
