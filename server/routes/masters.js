const express = require('express');
const Product = require('../models/Product');
const Vendor = require('../models/Vendor');
const Rack = require('../models/Rack');
const { authRequired } = require('../middleware/auth');
const { perm } = require('../permissions');
const { norm, uniqList } = require('../helpers');
const { masterKeys } = require('../ensureMasters');

const router = express.Router();
router.use(authRequired);

// Catalog for the client (matching + autocomplete). Returns each item's own
// racks/vendors lists plus a derived primary `rack`/`vendor` (first entry) so
// older clients keep working. `p.rack`/`p.vendor` are read too, to fold in any
// documents saved before the multi-value change.
router.get('/products', perm('items', 'view'), async (req, res) => {
  const ps = await Product.find({}, 'name racks vendors rack vendor aliases unit vendorName pid pdid timesUsed').sort({ timesUsed: -1, name: 1 }).lean();
  res.json(ps.map((p) => {
    const racks = uniqList(p.racks, p.rack);
    const vendors = uniqList(p.vendors, p.vendor);
    return { name: p.name, racks, vendors, rack: racks[0] || '', vendor: vendors[0] || '', aliases: p.aliases || [], unit: p.unit || '', vendorName: p.vendorName || '', pid: p.pid || '', pdid: p.pdid || '' };
  }));
});

router.get('/vendors', perm('vendors', 'view'), async (req, res) => {
  // collation → case-insensitive A→Z (so "OTHER" and "box" sort naturally).
  const vs = await Vendor.find({}, 'name').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).lean();
  res.json(vs.map((v) => v.name).filter((n) => n && n.trim()));
});

// The global pool of bin locations (any item can be received into any rack).
router.get('/racks', perm('racks', 'view'), async (req, res) => {
  const rs = await Rack.find({}, 'name').collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).lean();
  res.json(rs.map((r) => r.name).filter((n) => n && n.trim()));
});

// Replace the catalog from an uploaded Excel workbook (parsed on the client).
// Items carry only their name/aliases/unit here; racks and vendors are global
// pools. Any per-item racks/vendors supplied are *added* (never used to wipe the
// history an item has accumulated from real receipts).
router.post('/products/bulk', perm('items', 'add'), async (req, res) => {
  const products = Array.isArray(req.body && req.body.products) ? req.body.products : [];
  const vendors = Array.isArray(req.body && req.body.vendors) ? req.body.vendors : [];
  const racks = Array.isArray(req.body && req.body.racks) ? req.body.racks : [];
  const replace = !!(req.body && req.body.replace);

  const kept = [];
  let n = 0;
  for (const p of products) {
    const name = (p.name || '').trim();
    if (!name) continue;
    const nm = norm(name);
    kept.push(nm);
    const seedRacks = uniqList(p.racks, p.rack);
    const seedVendors = uniqList(p.vendors, p.vendor);
    const set = { name, aliases: p.aliases || [], unit: (p.unit || '').trim() };
    // Only overwrite the extra columns when the upload actually carries a value,
    // so re-uploading an OLD sheet (without these columns) never wipes them.
    const extra = { vendorName: p.vendorName, pid: p.pid, pdid: p.pdid };
    for (const [k, val] of Object.entries(extra)) { const s = String(val == null ? '' : val).trim(); if (s) set[k] = s; }
    const update = {
      $set: set,
      $unset: { rack: '', vendor: '' },
      $setOnInsert: { normName: nm },
    };
    const add = {};
    if (seedRacks.length) add.racks = { $each: seedRacks };
    if (seedVendors.length) add.vendors = { $each: seedVendors };
    if (Object.keys(add).length) update.$addToSet = add;
    await Product.updateOne({ normName: nm }, update, { upsert: true });
    n++;
  }
  // Upsert first, then (on replace) prune only what's gone — no empty window.
  // The hardcoded master items/vendors/racks are ALWAYS kept: a wrong or partial
  // upload can add or refresh, but it can never prune the shipped catalog. Guard
  // on kept.length too, so an empty upload can't wipe anything.
  const { productKeys, vendorNames, rackNames } = masterKeys();
  if (replace && kept.length) {
    const keep = [...new Set([...kept, ...productKeys])];
    await Product.deleteMany({ normName: { $nin: keep } });
  }

  const vNames = uniqList(vendors);
  for (const name of vNames) await Vendor.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
  if (replace && vNames.length) {
    const keep = uniqList(vNames, vendorNames);
    await Vendor.deleteMany({ name: { $nin: keep } });
  }

  const rNames = uniqList(racks);
  for (const name of rNames) await Rack.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
  if (replace && rNames.length) {
    const keep = uniqList(rNames, rackNames);
    await Rack.deleteMany({ name: { $nin: keep } });
  }

  res.json({ ok: true, products: n, vendors: vNames.length, racks: rNames.length });
});

// Wipe all master data (items + racks + vendors) for a clean re-upload.
// GRNs are untouched.
router.post('/clear', perm('items', 'add'), async (req, res) => {
  const [p, v, r] = await Promise.all([Product.deleteMany({}), Vendor.deleteMany({}), Rack.deleteMany({})]);
  res.json({ ok: true, products: p.deletedCount || 0, vendors: v.deletedCount || 0, racks: r.deletedCount || 0 });
});

// Add a single new product (used when a new item is imported/received).
// Racks/vendors accumulate (an item can gain more of each over time) rather
// than overwrite, so re-seeing an item from a new vendor/rack just extends it.
router.post('/products', perm('items', 'add'), async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required.' });
  const nm = norm(name);
  const racks = uniqList(req.body.racks, req.body.rack);
  const vendors = uniqList(req.body.vendors, req.body.vendor);
  const vendorName = (req.body.vendorName || req.body.vendor || '').trim();
  const update = { $set: { name }, $setOnInsert: { normName: nm, aliases: [] } };
  // Link a brand-new item to this vendor (setOnInsert → never overwrites the
  // master vendorName of an item that already exists).
  if (vendorName) update.$setOnInsert.vendorName = vendorName;
  const add = {};
  if (racks.length) add.racks = { $each: racks };
  if (vendors.length) add.vendors = { $each: vendors };
  if (Object.keys(add).length) update.$addToSet = add;
  await Product.updateOne({ normName: nm }, update, { upsert: true });
  res.json({ ok: true });
});

// ---- Individual master edits (add / rename / delete), purchase/admin only ----
// Names are passed in the body (not the URL) so rack codes with slashes such as
// "A/01-01(A)" work. Existing GRNs keep whatever they recorded — these edits only
// affect the master lists used for matching and autocomplete.

// Items
router.post('/products/add', perm('items', 'add'), async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Item name required.' });
  const nm = norm(name);
  const set = { name };
  if (Array.isArray(req.body.aliases)) set.aliases = req.body.aliases.map((a) => String(a).trim()).filter(Boolean);
  if (req.body.unit != null) set.unit = String(req.body.unit).trim();
  await Product.updateOne({ normName: nm }, { $set: set, $setOnInsert: { normName: nm } }, { upsert: true });
  res.json({ ok: true });
});
router.post('/products/rename', perm('items', 'edit'), async (req, res) => {
  const oldName = (req.body && req.body.oldName || '').trim();
  const name = (req.body && req.body.name || '').trim();
  if (!oldName || !name) return res.status(400).json({ error: 'Both names required.' });
  const oldNm = norm(oldName), nm = norm(name);
  const doc = await Product.findOne({ normName: oldNm });
  if (!doc) return res.status(404).json({ error: 'Item not found.' });
  if (nm !== oldNm && (await Product.findOne({ normName: nm }))) return res.status(409).json({ error: 'Another item already uses that name.' });
  doc.name = name; doc.normName = nm;
  if (Array.isArray(req.body.aliases)) doc.aliases = req.body.aliases.map((a) => String(a).trim()).filter(Boolean);
  if (req.body.unit != null) doc.unit = String(req.body.unit).trim();
  await doc.save();
  res.json({ ok: true });
});
router.post('/products/remove', perm('items', 'add'), async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Item name required.' });
  await Product.deleteOne({ normName: norm(name) });
  res.json({ ok: true });
});

// Simple name-list CRUD for the Rack and Vendor pools.
function nameListRoutes(path, Model, label, area) {
  router.post(path + '/add', perm(area, 'add'), async (req, res) => {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: label + ' required.' });
    await Model.updateOne({ name }, { $setOnInsert: { name } }, { upsert: true });
    res.json({ ok: true });
  });
  router.post(path + '/rename', perm(area, 'edit'), async (req, res) => {
    const name = (req.body && req.body.name || '').trim();
    const newName = (req.body && req.body.newName || '').trim();
    if (!name || !newName) return res.status(400).json({ error: 'Both names required.' });
    if (name !== newName && (await Model.findOne({ name: newName }))) return res.status(409).json({ error: 'That ' + label.toLowerCase() + ' already exists.' });
    await Model.updateOne({ name }, { $set: { name: newName } });
    res.json({ ok: true });
  });
  router.post(path + '/remove', perm(area, 'add'), async (req, res) => {
    const name = (req.body && req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: label + ' required.' });
    await Model.deleteOne({ name });
    res.json({ ok: true });
  });
}
nameListRoutes('/racks', Rack, 'Rack', 'racks');
nameListRoutes('/vendors', Vendor, 'Vendor', 'vendors');

module.exports = router;
