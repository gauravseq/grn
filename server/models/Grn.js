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
  // Splits SHARE the parent's seq and are told apart by a letter suffix: the
  // original is '' (never renamed), its splits are 'A', 'B', … So splitting
  // GRN-001 yields GRN-001 (A) and the next brand-new note is still GRN-002.
  suffix: { type: String, default: '' },
  // 'GRN-001' / 'GRN-001 (A)' once submitted; a 'deleted' tombstone keeps its
  // number; an unsubmitted draft carries a unique 'draft-<id>' placeholder.
  grnNo: { type: String, required: true, unique: true },
  date: { type: Date, default: Date.now },
  vendor: { type: String, default: '' },
  billNo: { type: String, default: '' },
  // Set when a purchaser marks the note purchased — required for that step.
  purchaseNo: { type: String, default: '' },
  // Notes split off the same truck/consignment share this key (the id of the
  // GRN the split originally came from), so siblings can be shown together.
  consignmentId: { type: String, default: '' },
  // draft → done (received) → purchased. 'deleted' is a number tombstone.
  status: { type: String, enum: ['draft', 'done', 'purchased', 'deleted'], default: 'draft' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  items: { type: [LineSchema], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

// A brand-new draft has no number yet — give it a unique placeholder so the
// unique(grnNo) index is satisfied. Submit swaps it for the real 'GRN-NNN'.
GrnSchema.pre('validate', function (next) {
  if (!this.grnNo) this.grnNo = 'draft-' + this._id;
  next();
});
// A submitted number is (seq, suffix) — so GRN-001 and GRN-001 (A) coexist while
// neither can be duplicated. Partial (not sparse): a compound sparse index would
// still index drafts, because they carry a suffix even with no seq, and every
// draft would then collide on {seq: null, suffix: ''}.
GrnSchema.index({ seq: 1, suffix: 1 }, { unique: true, partialFilterExpression: { seq: { $type: 'number' } } });

module.exports = model('Grn', GrnSchema);
