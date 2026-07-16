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
  // The running number. Assigned only on Submit; ABSENT while a note is an
  // unsubmitted draft. Numbers stay contiguous: new = max+1, deleting the last
  // frees its number, deleting a middle one leaves a 'deleted' tombstone.
  seq: { type: Number },
  // 'GRN-001' once submitted; a 'deleted' tombstone keeps its number; an
  // unsubmitted draft carries a unique 'draft-<id>' placeholder (never shown).
  grnNo: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  vendor: { type: String, default: '' },
  billNo: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'done', 'deleted'], default: 'draft' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  items: { type: [LineSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

// A brand-new draft has no number yet — give it a unique placeholder so the
// unique(grnNo) index is satisfied. Submit swaps it for the real 'GRN-NNN'.
GrnSchema.pre('validate', function (next) {
  if (!this.grnNo) this.grnNo = 'draft-' + this._id;
  next();
});
// Submitted numbers are unique; drafts (no seq) are ignored by the sparse index.
GrnSchema.index({ seq: 1 }, { unique: true, sparse: true });

module.exports = model('Grn', GrnSchema);
