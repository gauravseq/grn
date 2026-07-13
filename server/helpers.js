// Normalization shared with the client so matching keys line up.
const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').toUpperCase();

// Merge any number of values/arrays into a trimmed, case-insensitively de-duped
// list that preserves first-seen order (so the primary rack/vendor stays first).
const uniqList = (...groups) => {
  const out = [], seen = new Set();
  for (const g of groups) {
    const arr = Array.isArray(g) ? g : (g == null ? [] : [g]);
    for (const v of arr) {
      const s = String(v == null ? '' : v).trim();
      const k = s.toUpperCase();
      if (s && !seen.has(k)) { seen.add(k); out.push(s); }
    }
  }
  return out;
};

// Shape a Grn document for the client (ids as strings, camelCase already).
function shapeGrn(g) {
  return {
    id: g._id.toString(),
    grnNo: g.grnNo,
    date: g.date,
    vendor: g.vendor,
    billNo: g.billNo,
    status: g.status,
    items: (g.items || []).map((l) => ({
      id: l._id.toString(),
      name: l.name,
      rack: l.rack,
      expected: l.expected == null ? null : Number(l.expected),
      received: Number(l.received || 0),
      log: (l.log || []).map((x) => ({ qty: Number(x.qty), at: x.at })),
    })),
  };
}

function emitChange(req, grnId) {
  const io = req.app.get('io');
  if (io) io.to('grn:' + grnId).emit('grn:updated', { id: String(grnId) });
}

module.exports = { norm, uniqList, shapeGrn, emitChange };
