const { Schema, model } = require('mongoose');
const LogSchema = new Schema({
  qty: Number,
  at: { type: Date, default: Date.now },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });
const LineSchema = new Schema({
  name: { type: String, required: true },
  normName: { type: String, required: true },
  rack: { type: String, default: '' },
  expected: { type: Number, default: null },
  received: { type: Number, default: 0 },
  log: { type: [LogSchema], default: [] },
});
const GrnSchema = new Schema({
  grnNo: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  vendor: { type: String, default: '' },
  billNo: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'done'], default: 'draft' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  items: { type: [LineSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true });
module.exports = model('Grn', GrnSchema);
