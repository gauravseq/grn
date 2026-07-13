const express = require('express');
const Grn = require('../models/Grn');
const Vendor = require('../models/Vendor');
const Counter = require('../models/Counter');
const Product = require('../models/Product');
const Rack = require('../models/Rack');
const { authRequired } = require('../middleware/auth');
const { perm } = require('../permissions');
const { norm, uniqList, shapeGrn, emitChange } = require('../helpers');

const router = express.Router();
router.use(authRequired);

// GRN numbers are permanent and unique: "GRN-" (fixed prefix) + a monotonic
// counter. Deleting a GRN never lowers the counter, so a number is never reused
// (you get a gap, never a repeat). As a hard safeguard, we also ensure the new
// number is always higher than every existing GRN — so even if the counter were
// ever set too low, a number can't collide with one already in use.
async function nextGrnNo() {
  const c = await Counter.findByIdAndUpdate('grn', { $inc: { seq: 1 } }, { new: true, upsert: true });
  let seq = c.seq;
  const docs = await Grn.find({}, 'grnNo').lean();
  let maxNum = 0;
  for (const d of docs) { const m = String(d.grnNo || '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > maxNum) maxNum = n; } }
  if (seq <= maxNum) { seq = maxNum + 1; await Counter.updateOne({ _id: 'grn' }, { $set: { seq } }); }
  return 'GRN-' + String(seq).padStart(3, '0');
}

// Learn/upsert the shared catalog when goods are received: bump usage and add
// this receipt's rack and the GRN's vendor to the item's lists (accumulating,
// so an item naturally gathers every rack it lands in and every vendor it comes from).
async function learnProduct(name, rack, vendor) {
  const nm = norm(name);
  if (!nm) return;
  const update = { $set: { name: name.trim() }, $inc: { timesUsed: 1 }, $setOnInsert: { normName: nm, aliases: [] } };
  // First time we see a walk-in item, link it to the GRN's vendor (setOnInsert →
  // won't overwrite the vendorName of an item already in the master catalog).
  if (vendor && vendor.trim()) update.$setOnInsert.vendorName = vendor.trim();
  const add = {};
  if (rack && rack.trim()) add.racks = rack.trim();
  if (vendor && vendor.trim()) add.vendors = vendor.trim();
  if (Object.keys(add).length) update.$addToSet = add;
  await Product.updateOne({ normName: nm }, update, { upsert: true });
}

// Any rack typed on a receipt joins the global bin pool so it autocompletes next time.
async function learnRack(rack) {
  const name = (rack || '').trim();
  if (name) await Rack.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
}

// Load a GRN, apply mutate(g), and save under optimistic concurrency.
// Because several people can work the same GRN at once, two saves can race;
// the schema's version check makes the loser throw VersionError, and we retry
// against a fresh copy so no addition is ever silently lost.
// mutate may return { error, code } to short-circuit with a 4xx.
const MAX_RETRIES = 40;
async function editGrn(id, mutate) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const g = await Grn.findById(id);
    if (!g) return { code: 404, error: 'GRN not found.' };
    const bail = mutate(g);
    if (bail && bail.error) return bail;
    try { await g.save(); return { grn: g }; }
    catch (e) {
      if (e.name === 'VersionError' && attempt < MAX_RETRIES - 1) continue;
      throw e;
    }
  }
  return { code: 409, error: 'Too many people editing this GRN at once — try again.' };
}

// List (dashboard summaries)
router.get('/', perm('grn', 'view'), async (req, res) => {
  const grns = await Grn.find({}, 'grnNo date vendor billNo status items updatedAt').sort({ updatedAt: -1 }).lean();
  res.json(grns.map((g) => ({
    id: g._id.toString(), grnNo: g.grnNo, date: g.date, vendor: g.vendor, billNo: g.billNo,
    status: g.status, items: (g.items || []).length,
    totalQty: (g.items || []).reduce((s, l) => s + (Number(l.received) || 0), 0),
    totalExpected: (g.items || []).reduce((s, l) => s + (l.expected != null ? Number(l.expected) || 0 : 0), 0),
    updatedAt: g.updatedAt,
  })));
});

router.post('/', perm('grn', 'add'), async (req, res) => {
  const g = await Grn.create({ grnNo: await nextGrnNo(), createdBy: req.user.id });
  res.json(shapeGrn(g));
});

// Full GRNs for reporting/export, filtered by vendor and/or date range.
// (Declared before '/:id' so "report" isn't parsed as an id.)
router.get('/report', perm('reports', 'view'), async (req, res) => {
  const { vendor, from, to } = req.query || {};
  const q = {};
  if (vendor && String(vendor).trim()) {
    const v = String(vendor).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    q.vendor = new RegExp('^' + v + '$', 'i');
  }
  if (from || to) {
    q.date = {};
    if (from) { const d = new Date(from); if (!isNaN(d)) q.date.$gte = d; }
    if (to) { const d = new Date(to); if (!isNaN(d)) { d.setHours(23, 59, 59, 999); q.date.$lte = d; } }
    if (!Object.keys(q.date).length) delete q.date;
  }
  const grns = await Grn.find(q).sort({ date: 1, grnNo: 1 });
  res.json(grns.map(shapeGrn));
});

router.get('/:id', perm('grn', 'view'), async (req, res) => {
  const g = await Grn.findById(req.params.id);
  if (!g) return res.status(404).json({ error: 'GRN not found.' });
  res.json(shapeGrn(g));
});

router.patch('/:id', perm('grn', 'edit'), async (req, res) => {
  const { vendor, billNo, date, status } = req.body || {};
  const r = await editGrn(req.params.id, (g) => {
    if (vendor !== undefined) g.vendor = vendor;
    if (billNo !== undefined) g.billNo = billNo;
    if (date !== undefined && date) g.date = date;
    if (status !== undefined && ['draft', 'done'].includes(status)) g.status = status;
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  if (vendor && vendor.trim()) await Vendor.updateOne({ name: vendor.trim() }, { $setOnInsert: { name: vendor.trim() } }, { upsert: true });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

router.delete('/:id', perm('grn', 'add'), async (req, res) => {
  await Grn.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Add received qty. Stacking is per item *and* rack: the same item into the
// same bin stacks onto that line; the same item into a different bin becomes a
// new line so each bin keeps its own quantity (a full bin never overwrites a
// previous one). The first placement of an imported item adopts its rack-less
// expected line so reconciliation still lines up.
router.post('/:id/lines', perm('grn', 'edit'), async (req, res) => {
  const { name, rack, qty } = req.body || {};
  const q = Number(qty);
  if (!name || !name.trim()) return res.status(400).json({ error: 'Item name required.' });
  if (!q || q <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0.' });
  const nm = norm(name);
  const rk = (rack || '').trim();
  const r = await editGrn(req.params.id, (g) => {
    let line = g.items.find((l) => l.normName === nm && (l.rack || '') === rk);
    if (!line && rk) line = g.items.find((l) => l.normName === nm && !(l.rack || '') && (Number(l.received) || 0) === 0);
    if (line) {
      line.received = (Number(line.received) || 0) + q;
      if (rk) line.rack = rk;
      line.log.push({ qty: q, userId: req.user.id });
    } else {
      g.items.push({ name: name.trim(), normName: nm, rack: rk, received: q, expected: null, log: [{ qty: q, userId: req.user.id }] });
    }
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  await learnProduct(name, rack, r.grn.vendor);
  await learnRack(rack);
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

// Add an EMPTY bin (a rack slot with 0 received) so an item can be placed in
// several racks before/without unloading into them yet. If the item currently
// has only a rack-less line (e.g. an imported "expected" row with nothing
// received), that line simply adopts the rack instead of leaving a phantom. If
// the exact (item, rack) bin already exists, it's a no-op.
router.post('/:id/lines/bin', perm('grn', 'edit'), async (req, res) => {
  const { name, rack } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Item name required.' });
  const rk = (rack || '').trim();
  const nm = norm(name);
  const r = await editGrn(req.params.id, (g) => {
    if (rk) {
      if (g.items.find((l) => l.normName === nm && (l.rack || '') === rk)) return; // that bin exists
      const orphan = g.items.find((l) => l.normName === nm && !(l.rack || '') && (Number(l.received) || 0) === 0);
      if (orphan) orphan.rack = rk;
      else g.items.push({ name: name.trim(), normName: nm, rack: rk, received: 0, expected: null, log: [] });
    } else {
      // No rack given: add the item as an awaiting line (0 received) if it isn't
      // already in this note — rack + qty get set on the row afterward.
      if (g.items.some((l) => l.normName === nm)) return;
      g.items.push({ name: name.trim(), normName: nm, rack: '', received: 0, expected: null, log: [] });
    }
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  await learnProduct(name, rk, r.grn.vendor);
  await learnRack(rk);
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

// Import vendor list as Expected. Idempotent: re-importing the same list REPLACES
// each item's expected instead of stacking, so uploading twice can't double/triple
// the quantities. Duplicate rows *within a single upload* are still summed.
router.post('/:id/import', perm('grn', 'edit'), async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  // Resolve racks for brand-new lines before the (retryable) mutation.
  const prepared = [];
  for (const row of rows) {
    const name = (row.name || '').trim();
    const exp = Number(row.qty);
    if (!name || !exp || exp <= 0) continue;
    let rack = (row.rack || '').trim();
    if (!rack) { const p = await Product.findOne({ normName: norm(name) }); if (p) rack = (p.racks && p.racks[0]) || p.rack || ''; }
    prepared.push({ name, nm: norm(name), exp, rack });
  }
  // Merge duplicate rows within THIS upload, per item, into a single expected total.
  const byItem = new Map();
  for (const row of prepared) {
    const cur = byItem.get(row.nm);
    if (cur) { cur.exp += row.exp; if (!cur.rack && row.rack) cur.rack = row.rack; }
    else byItem.set(row.nm, { name: row.name, nm: row.nm, exp: row.exp, rack: row.rack });
  }
  const r = await editGrn(req.params.id, (g) => {
    for (const row of byItem.values()) {
      const line = g.items.find((l) => l.normName === row.nm);
      if (line) {
        line.expected = row.exp;              // SET (replace), never accumulate → re-import is safe
        if (row.rack && !line.rack) line.rack = row.rack;
      } else {
        g.items.push({ name: row.name, normName: row.nm, rack: row.rack, expected: row.exp, received: 0, log: [] });
      }
    }
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

// Quick add to a specific line.
router.post('/:id/lines/:lineId/add', perm('grn', 'edit'), async (req, res) => {
  const q = Number(req.body && req.body.qty);
  if (!q || q <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0.' });
  const r = await editGrn(req.params.id, (g) => {
    const line = g.items.id(req.params.lineId);
    if (!line) return { code: 404, error: 'Line not found.' };
    line.received = (Number(line.received) || 0) + q;
    line.log.push({ qty: q, userId: req.user.id });
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

// Edit a line (received / expected / rack / name).
router.patch('/:id/lines/:lineId', perm('grn', 'edit'), async (req, res) => {
  const { received, expected, rack, name } = req.body || {};
  const r = await editGrn(req.params.id, (g) => {
    const line = g.items.id(req.params.lineId);
    if (!line) return { code: 404, error: 'Line not found.' };
    if (received !== undefined) line.received = Number(received) || 0;
    if (expected !== undefined) line.expected = expected === null || expected === '' ? null : Number(expected);
    if (rack !== undefined) line.rack = rack;
    if (name !== undefined && name.trim()) { line.name = name.trim(); line.normName = norm(name); }
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  if (rack !== undefined) await learnRack(rack);
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

router.delete('/:id/lines/:lineId', perm('grn', 'add'), async (req, res) => {
  const r = await editGrn(req.params.id, (g) => {
    const line = g.items.id(req.params.lineId);
    if (line) line.deleteOne();
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

module.exports = router;
