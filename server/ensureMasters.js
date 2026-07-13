// Hardcoded master catalog — self-healing safety net.
//
// The full item/rack/vendor lists from the shipped master sheet live in
// master-data.json (baked into the app). ensureMasters() upserts every one of
// them on server startup. It is strictly ADDITIVE — it never deletes — so it
// can only restore what's missing, never wipe anything a user added. This is why
// a bad/partial "replace" upload can no longer permanently lose the catalog: the
// next restart puts it right back, and masterKeys() lets the upload route refuse
// to prune these items in the first place.

const path = require('path');
const Product = require('./models/Product');
const Vendor = require('./models/Vendor');
const Rack = require('./models/Rack');
const { norm } = require('./helpers');

let DATA = { products: [], vendors: [], racks: [] };
try { DATA = require('./master-data.json'); }
catch (e) { console.warn('⚠ master-data.json not found — hardcoded catalog disabled.'); }

// Sets of the hardcoded identities, so the upload route can protect them from
// its own `replace` prune (never delete a shipped master item/vendor/rack).
const productKeys = new Set((DATA.products || []).map((p) => p.normName || norm(p.name)));
const vendorNames = (DATA.vendors || []).slice();
const rackNames = (DATA.racks || []).slice();

function masterKeys() {
  return { productKeys, vendorNames, rackNames };
}

// Restore the hardcoded catalog. RESTORE-ONLY: every field is written with
// $setOnInsert, so an item that already exists is never touched — all of its
// edits (aliases, unit, vendorName/pid/pdid, accumulated racks/vendors, usage)
// are preserved across restarts. Only items that are actually MISSING get
// re-created from the baseline. Nothing is ever deleted.
async function ensureMasters() {
  if (!DATA.products || !DATA.products.length) return { products: 0, vendors: 0, racks: 0 };

  const pOps = DATA.products.map((p) => {
    const nm = p.normName || norm(p.name);
    return {
      updateOne: {
        filter: { normName: nm },
        update: {
          $setOnInsert: {
            normName: nm, name: p.name, aliases: p.aliases || [], unit: p.unit || '',
            vendorName: p.vendorName || '', pid: p.pid || '', pdid: p.pdid || '',
          },
        },
        upsert: true,
      },
    };
  });
  const vOps = vendorNames.map((name) => ({
    updateOne: { filter: { name }, update: { $setOnInsert: { name } }, upsert: true },
  }));
  const rOps = rackNames.map((name) => ({
    updateOne: { filter: { name }, update: { $setOnInsert: { name } }, upsert: true },
  }));

  // Chunk the product bulk write so a very large catalog stays comfortable.
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  for (const c of chunk(pOps, 1000)) await Product.bulkWrite(c, { ordered: false });
  if (vOps.length) await Vendor.bulkWrite(vOps, { ordered: false });
  for (const c of chunk(rOps, 1000)) await Rack.bulkWrite(c, { ordered: false });

  return { products: DATA.products.length, vendors: vendorNames.length, racks: rackNames.length };
}

module.exports = { ensureMasters, masterKeys };
