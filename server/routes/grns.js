const express = require('express');
const Grn = require('../models/Grn');
const Product = require('../models/Product'); // read-only here (import rack lookup); receiving never writes masters
const { authRequired } = require('../middleware/auth');
const { perm, canPerms } = require('../permissions');
const { norm, uniqList, shapeGrn, emitChange } = require('../helpers');

const router = express.Router();
router.use(authRequired);

// Numbering is derived from the notes themselves (no separate counter), so it
// self-corrects: new = highest+1, deleting the highest lowers it, deleting a
// middle one leaves a 'deleted' tombstone that keeps the slot.
async function maxSeq() {
  const top = await Grn.findOne({ seq: { $ne: null } }).sort({ seq: -1 }).select('seq').lean();
  return top && top.seq ? top.seq : 0;
}
// The base number every note in a consignment is filed under.
function baseNoFor(seq) { return 'GRN-' + String(seq).padStart(3, '0'); }
// Splitting never burns a number: a split keeps its parent's seq and takes the
// next free letter, so 'GRN-001' begets 'GRN-001 (A)' and the next NEW note is
// still GRN-002. The base note itself keeps suffix '' and is never renamed.
function grnNoFor(seq, suffix) { return baseNoFor(seq) + (suffix ? ` (${suffix})` : ''); }
// A, B, … Z, AA, AB … (spreadsheet-column style, so a 27th split still works).
function suffixAt(n) {
  let s = '';
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
}
// Lowest letter not already used anywhere in this consignment — so a suffix
// freed by deleting a split gets reused rather than leaving a gap.
async function nextSuffix(seq) {
  const sibs = await Grn.find({ seq }).select('suffix').lean();
  const used = new Set(sibs.map((s) => s.suffix || ''));
  for (let i = 0; i < 4000; i++) { const s = suffixAt(i); if (!used.has(s)) return s; }
  return null;
}

// NOTE: Receiving goods NEVER writes to the master lists. Items, racks and
// vendors typed on a GRN stay on that GRN only. The master catalog / rack pool /
// vendor list are edited exclusively through "Edit lists" and workbook upload
// (see routes/masters.js), plus the boot-time baseline restore (ensureMasters).

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

// Hard, role-based locks (NOT permission-based — they can't be granted away):
//   • received ("done")  → only an admin may edit/reopen/delete it.
//   • purchased          → only an admin may change it, full stop.
// The one carve-out is the dedicated "mark purchased" route below, which lets a
// purchaser move a received note to purchased without unlocking anything else.
function lockCheck(g, req) {
  if (req.user && req.user.role === 'admin') return null;
  if (g.status === 'purchased') {
    return { code: 423, error: 'This GRN is marked purchased and locked. Only an admin can change it.' };
  }
  if (g.status === 'done') {
    return { code: 423, error: 'This GRN is marked received and locked. Ask an admin to reopen it.' };
  }
  return null;
}

// List (dashboard summaries). Unsubmitted drafts (no seq) are hidden; submitted
// notes AND 'deleted' tombstones are shown, newest number first.
router.get('/', perm('grn', 'view'), async (req, res) => {
  const grns = await Grn.find({ seq: { $ne: null } }, 'seq suffix grnNo date vendor billNo purchaseNo consignmentId status items updatedAt').sort({ seq: -1, suffix: 1 }).lean();
  res.json(grns.map((g) => ({
    id: g._id.toString(), seq: g.seq, suffix: g.suffix || '', baseNo: baseNoFor(g.seq), grnNo: g.grnNo,
    date: g.date, vendor: g.vendor, billNo: g.billNo,
    purchaseNo: g.purchaseNo || '', consignmentId: g.consignmentId || '', status: g.status, items: (g.items || []).length,
    totalQty: (g.items || []).reduce((s, l) => s + (Number(l.received) || 0), 0),
    totalExpected: (g.items || []).reduce((s, l) => s + (l.expected != null ? Number(l.expected) || 0 : 0), 0),
    updatedAt: g.updatedAt,
  })));
});

// New GRN = an unsubmitted DRAFT (no number yet). It doesn't show in the list
// and burns no number until Submit. Abandoned drafts are discarded (DELETE).
router.post('/', perm('grn', 'add'), async (req, res) => {
  const g = await Grn.create({ createdBy: req.user.id });
  res.json(shapeGrn(g));
});

// Submit a draft → assign the next number and make it a real GRN.
router.patch('/:id/submit', perm('grn', 'add'), async (req, res) => {
  const g = await Grn.findById(req.params.id);
  if (!g) return res.status(404).json({ error: 'GRN not found.' });
  if (g.status === 'deleted') return res.status(400).json({ error: 'This GRN was deleted.' });
  if (g.seq != null) return res.json(shapeGrn(g)); // already submitted — no-op
  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = (await maxSeq()) + 1;
    g.seq = seq; g.suffix = ''; g.grnNo = grnNoFor(seq, '');
    try { await g.save(); emitChange(req, g._id); return res.json(shapeGrn(g)); }
    catch (e) {
      if ((e.code === 11000 || e.name === 'VersionError') && attempt < 19) { g.seq = undefined; continue; }
      throw e;
    }
  }
  res.status(409).json({ error: 'Could not assign a GRN number — please try again.' });
});

// Mark a RECEIVED note as PURCHASED. This is the one action a non-admin may take
// on a locked (received) GRN, and only a purchaser/admin may take it. A purchase
// number is compulsory. Once purchased, lockCheck makes it admin-only entirely.
router.patch('/:id/purchase', async (req, res) => {
  const purchaseNo = String((req.body && req.body.purchaseNo) || '').trim();
  if (!purchaseNo) return res.status(400).json({ error: 'A purchase number is required to mark this GRN purchased.' });
  // "Mark purchased" is a grantable permission — held by the purchase role (and
  // admin) by default, and adjustable per user from the Permissions grid.
  if (!canPerms(req.user.perms, 'grn', 'purchase')) {
    return res.status(403).json({ error: 'You do not have permission to mark a GRN purchased.' });
  }
  const r = await editGrn(req.params.id, (g) => {
    if (g.seq == null) return { code: 400, error: 'Submit this GRN before marking it purchased.' };
    if (g.status === 'purchased') return { code: 400, error: 'This GRN is already marked purchased.' };
    if (g.status !== 'done') return { code: 400, error: 'Mark the GRN received before marking it purchased.' };
    g.status = 'purchased';
    g.purchaseNo = purchaseNo;
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

// Split urgent material off a GRN into a NEW linked GRN.
// Body: { lines: [{ lineId, qty }] }. Quantities MOVE (they're deducted here and
// added there) so expected/received across the group always equal the truck.
// The split is NUMBERED AS A SUFFIX of the same consignment — one truck, one
// bill, one base number — so it doesn't advance the counter. It's created
// already numbered: a deliberate action with real content needs no Submit.
router.post('/:id/split', perm('grn', 'add'), async (req, res) => {
  const wanted = Array.isArray(req.body && req.body.lines) ? req.body.lines : [];
  if (!wanted.length) return res.status(400).json({ error: 'Pick at least one item to split.' });

  const src = await Grn.findById(req.params.id);
  if (!src) return res.status(404).json({ error: 'GRN not found.' });
  if (src.seq == null) return res.status(400).json({ error: 'Submit this GRN before splitting it.' });
  if (!canPerms(req.user.perms, 'grn', 'edit')) return res.status(403).json({ error: 'You do not have permission to change this GRN.' });
  const lk = lockCheck(src, req); if (lk) return res.status(lk.code).json({ error: lk.error });

  // Work out exactly what moves, validating against what's actually there.
  const moves = [];
  for (const w of wanted) {
    const line = src.items.id(w.lineId);
    if (!line) return res.status(400).json({ error: 'One of the items is no longer on this GRN.' });
    const q = Number(w.qty);
    if (!q || q <= 0) continue;
    const exp = line.expected == null ? null : Number(line.expected) || 0;
    const rec = Number(line.received) || 0;
    const available = Math.max(exp == null ? 0 : exp, rec);
    if (q > available) return res.status(400).json({ error: `Can't split ${q} of "${line.name}" — only ${available} available.` });
    moves.push({
      lineId: String(line._id), name: line.name, normName: line.normName, rack: line.rack || '',
      moveExp: exp == null ? null : Math.min(q, exp),
      moveRec: Math.min(q, rec),
    });
  }
  if (!moves.length) return res.status(400).json({ error: 'Enter a quantity to split.' });

  // Create the new note FIRST, so a failure can't leave the source short. It
  // shares the source's seq (the base number of the whole consignment) and only
  // takes the next free letter; two racers collide on {seq, suffix} and retry.
  const consignment = src.consignmentId || src._id.toString();
  let target;
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = await nextSuffix(src.seq);
    if (!suffix) break;
    try {
      target = await Grn.create({
        seq: src.seq, suffix, grnNo: grnNoFor(src.seq, suffix),
        date: src.date, vendor: src.vendor, billNo: src.billNo,
        status: 'draft', createdBy: req.user.id, consignmentId: consignment,
        items: moves.map((m) => ({ name: m.name, normName: m.normName, rack: m.rack, expected: m.moveExp, received: m.moveRec, log: [] })),
      });
      break;
    } catch (e) {
      if ((e.code === 11000) && attempt < 19) continue;
      throw e;
    }
  }
  if (!target) return res.status(409).json({ error: 'Could not assign a GRN number — please try again.' });

  // Now deduct from the source. If that fails, roll the new note back.
  try {
    const r = await editGrn(src._id, (g) => {
      const lk2 = lockCheck(g, req); if (lk2) return lk2;
      for (const m of moves) {
        const line = g.items.id(m.lineId);
        if (!line) return { code: 409, error: 'That GRN changed while splitting — try again.' };
        if (m.moveExp != null) line.expected = Math.max(0, (Number(line.expected) || 0) - m.moveExp);
        line.received = Math.max(0, (Number(line.received) || 0) - m.moveRec);
        // A line with nothing left on either side is dropped entirely.
        if ((line.expected == null || line.expected === 0) && (Number(line.received) || 0) === 0) line.deleteOne();
      }
      if (!g.consignmentId) g.consignmentId = consignment;
    });
    if (r.error) { await Grn.deleteOne({ _id: target._id }); return res.status(r.code).json({ error: r.error }); }
    emitChange(req, r.grn._id); emitChange(req, target._id);
    return res.json({ source: shapeGrn(r.grn), created: shapeGrn(target) });
  } catch (e) {
    await Grn.deleteOne({ _id: target._id }).catch(() => {});
    throw e;
  }
});

// The whole consignment behind one base number: the original note plus every
// split off it, with the group's combined totals. One truck, one bill — this is
// the view that shows what the full load actually was, however it was split.
router.get('/:id/consignment', perm('grn', 'view'), async (req, res) => {
  const g = await Grn.findById(req.params.id).select('seq');
  if (!g) return res.status(404).json({ error: 'GRN not found.' });
  if (g.seq == null) return res.json({ baseNo: null, notes: [], totalExpected: 0, totalReceived: 0 });
  const sibs = await Grn.find({ seq: g.seq }).sort({ suffix: 1 }).lean();
  const notes = sibs.map((s) => ({
    id: s._id.toString(), grnNo: s.grnNo, suffix: s.suffix || '', status: s.status,
    date: s.date, vendor: s.vendor, billNo: s.billNo, purchaseNo: s.purchaseNo || '',
    items: (s.items || []).length,
    totalExpected: (s.items || []).reduce((a, l) => a + (l.expected != null ? Number(l.expected) || 0 : 0), 0),
    totalReceived: (s.items || []).reduce((a, l) => a + (Number(l.received) || 0), 0),
  }));
  res.json({
    baseNo: baseNoFor(g.seq),
    notes,
    totalExpected: notes.reduce((a, n) => a + n.totalExpected, 0),
    totalReceived: notes.reduce((a, n) => a + n.totalReceived, 0),
  });
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
  const grns = await Grn.find(q).sort({ date: 1, seq: 1, suffix: 1 });
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
    const lk = lockCheck(g, req); if (lk) return lk; // received GRNs: admin-only (covers reopen + edits)
    if (vendor !== undefined) g.vendor = vendor;
    if (billNo !== undefined) g.billNo = billNo;
    if (date !== undefined && date) g.date = date;
    // Only an admin ever reaches here on a purchased note (lockCheck above);
    // moving it back out of 'purchased' clears the purchase number.
    if (status !== undefined && ['draft', 'done'].includes(status)) {
      if (g.status === 'purchased') g.purchaseNo = '';
      g.status = status;
    }
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  // NB: a vendor typed on a GRN is NOT added to the Vendor master — the master
  // lists (items/racks/vendors) are only edited via "Edit lists" / workbook upload.
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

router.delete('/:id', async (req, res) => {
  const g = await Grn.findById(req.params.id).select('seq suffix status');
  if (!g) return res.json({ ok: true });

  // Unsubmitted draft → discarding it is part of the create flow (needs 'add').
  if (g.seq == null) {
    if (!canPerms(req.user.perms, 'grn', 'add')) return res.status(403).json({ error: 'You do not have permission for this.' });
    await Grn.deleteOne({ _id: g._id });
    return res.json({ ok: true, discarded: true });
  }

  // Deleting a real GRN requires the separate Delete permission.
  if (!canPerms(req.user.perms, 'grn', 'delete')) return res.status(403).json({ error: 'You do not have permission to delete a GRN.' });
  const lk = lockCheck(g, req); if (lk) return res.status(lk.code).json({ error: lk.error });
  if (g.status === 'deleted') { await Grn.deleteOne({ _id: g._id }); return res.json({ ok: true }); }

  // A SPLIT owns no number of its own — it borrows the base's. Removing it frees
  // its letter and leaves the numbering completely untouched, so no tombstone.
  if (g.suffix) {
    await Grn.deleteOne({ _id: g._id });
    return res.json({ ok: true, removed: true });
  }

  // The BASE note is the consignment's number. Deleting it while splits still
  // hang off it would orphan them, so the splits have to go (or be kept) first.
  const splits = await Grn.find({ seq: g.seq, suffix: { $ne: '' } }).select('grnNo').lean();
  if (splits.length) {
    return res.status(409).json({
      error: `${baseNoFor(g.seq)} has ${splits.length} split note(s) — ${splits.map((s) => s.grnNo).join(', ')}. Delete those first.`,
    });
  }

  const mx = await maxSeq();
  if (g.seq >= mx) {
    // Deleting the LAST (highest) number → remove it, and cascade away any
    // 'deleted' tombstones sitting right below it, so the counter drops and the
    // freed number is reused by the next new GRN.
    await Grn.deleteOne({ _id: g._id });
    let cur = g.seq - 1;
    while (cur > 0) {
      const t = await Grn.findOne({ seq: cur, suffix: '' }).select('_id status');
      if (t && t.status === 'deleted') { await Grn.deleteOne({ _id: t._id }); cur--; } else break;
    }
    return res.json({ ok: true, removed: true });
  }

  // Deleting a MIDDLE number → leave a 'deleted' tombstone in its place, so the
  // numbering stays contiguous and that number is never reused.
  await Grn.updateOne({ _id: g._id }, { $set: { status: 'deleted', items: [], vendor: '', billNo: '' } });
  emitChange(req, g._id);
  res.json({ ok: true, tombstoned: true });
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
    const lk = lockCheck(g, req); if (lk) return lk;
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
  // Received items/racks are NOT written back to the master catalog — masters
  // change only via "Edit lists" / workbook upload.
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
    const lk = lockCheck(g, req); if (lk) return lk;
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
  // Masters are not auto-updated from receiving — only via "Edit lists" / upload.
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
    const lk = lockCheck(g, req); if (lk) return lk;
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
    const lk = lockCheck(g, req); if (lk) return lk;
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
    const lk = lockCheck(g, req); if (lk) return lk;
    const line = g.items.id(req.params.lineId);
    if (!line) return { code: 404, error: 'Line not found.' };
    if (received !== undefined) line.received = Number(received) || 0;
    if (expected !== undefined) line.expected = expected === null || expected === '' ? null : Number(expected);
    if (rack !== undefined) line.rack = rack;
    if (name !== undefined && name.trim()) { line.name = name.trim(); line.normName = norm(name); }
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

router.delete('/:id/lines/:lineId', perm('grn', 'delete'), async (req, res) => {
  const r = await editGrn(req.params.id, (g) => {
    const lk = lockCheck(g, req); if (lk) return lk;
    const line = g.items.id(req.params.lineId);
    if (line) line.deleteOne();
  });
  if (r.error) return res.status(r.code).json({ error: r.error });
  emitChange(req, r.grn._id);
  res.json(shapeGrn(r.grn));
});

module.exports = router;
