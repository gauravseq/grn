// Catalog matching, PDF/paste parsing, and Excel read/write.
// pdf.js and SheetJS load from CDN in index.html (window.pdfjsLib / window.XLSX).

export const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').toUpperCase();
export const normKey = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) { const cost = a[i - 1] === b[j - 1] ? 0 : 1; cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost); }
    prev = cur;
  }
  return prev[n];
}
const simRatio = (a, b) => { if (!a || !b) return 0; const mx = Math.max(a.length, b.length); return mx ? 1 - lev(a, b) / mx : 0; };
function tokenJaccard(a, b) {
  const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / new Set([...A, ...B]).size;
}
function coverage(masterKey, vendorKey) {
  const S = masterKey.split(' ').filter(Boolean); if (S.length < 2) return 0;
  const L = vendorKey.split(' ').filter(Boolean); if (!L.length) return 0;
  let hit = 0;
  S.forEach((t) => { if (L.some((w) => w === t || (t.length >= 3 && (w.startsWith(t) || t.startsWith(w))))) hit++; });
  return hit / S.length;
}

// ---- format-agnostic item identity (shared by matching + parsing) ----
// Short alnum tokens that are finish/grade/packaging noise, never an identity.
const NOISE = new Set(['MM', 'CM', 'SP', 'PR', 'PRE', 'STD', 'GOLD', 'ECO', 'DIC', 'SUB', 'QTY', 'SR', 'NO', 'PO', 'LR', 'SIZE', 'SET', 'PCS', 'NOS']);
const unpad = (w) => w.replace(/^([A-Z]+)0+(\d)/, '$1$2');   // W01 -> W1, Z07 -> Z7

// Normalise a raw line: drop a leading serial, join a split "1 . 00" and a split
// single-letter code ("Z 7" -> "Z7", but never "ZA 20").
function clean(raw) {
  let s = (raw || '').toUpperCase();
  s = s.replace(/^\s*\d{1,4}[.)]?\s+/, '');
  s = s.replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
  s = s.replace(/\b([A-Z])\s+(\d)\b/g, '$1$2');
  return s;
}
// Remove thickness ("1.00", "1 MM") and size ("(8X4)", "2440 MM X 1220 MM").
function stripThickSize(s) {
  s = s.replace(/\b\d+\.\d+\b/g, ' ');
  s = s.replace(/\b\d+\s*MM\b/g, ' ');
  s = s.replace(/\bMM\b/g, ' ');
  s = s.replace(/\(?\s*\d+\s*[X*]\s*\d+\s*\)?/g, ' ');
  s = s.replace(/\(\s*\d+\s*\)/g, ' ');
  return s.replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
// The cleaned identity string: thickness/size stripped, noise words dropped.
function identity(raw) {
  const t = stripThickSize(clean(raw));
  return t.split(' ').filter((w) => w && !NOISE.has(w)).join(' ');
}

// A vendor "design code" = a number (2–5 digits) plus the short suffix that
// follows it, keeping any trailing digit (so W2≠W8, FR2≠FR3, FL1≠FL2). Ignores
// prefixes/brand words/separators, so NF/9401-ZA, VN 9401 ZA VNEXC and OV/632-DA
// all reduce to 9401ZA / 632DA. '' when there's no recognisable code.
export function designCode(s) {
  const m = identity(s).match(/(\d{2,5})[^A-Z0-9]{0,3}([A-Z]{1,3}\d{0,3})(?![A-Z0-9])/);
  return m ? m[1] + unpad(m[2]) : '';
}

// A format-agnostic signature: the design NUMBER (first 3–5 digit number) plus
// its distinctive short CODE tokens (whole 2–4 char tokens, letters or
// letter+digit — never chunks of a long word). A long glued finish token
// (VNRMONTK) also contributes its 3-letter lead (VNR), so glued catalog names
// still line up. This is what stays stable across "VNR 3147", "MO 3147 CROSS VNR"
// and "NV 3147 VNR MONTX".
export function nameSignature(raw) {
  const t = identity(raw);
  const allNums = [...t.matchAll(/\d{3,5}/g)].map((m) => m[0]);
  const designNum = allNums.length ? allNums[0] : null;
  const codes = [];
  t.split(' ').forEach((w) => {
    if (/^[A-Z]{1,3}\d{0,3}$/.test(w)) {
      const L = (w.match(/[A-Z]/g) || []).length, D = /\d/.test(w);
      if (!NOISE.has(w) && ((L >= 2) || (L >= 1 && D))) codes.push(unpad(w));
    } else if (/^[A-Z]{6,}$/.test(w)) {
      codes.push(w.slice(0, 3));
    }
  });
  return { designNum, numSet: new Set(allNums), codes, codeSet: new Set(codes) };
}

// Build a fast lookup from the catalog (name + aliases -> product), plus a
// design-code index (code -> products sharing that code).
export function buildIndex(catalog) {
  const idx = new Map();
  const codeIndex = new Map();
  const numIndex = new Map(); // design number -> [products carrying it]
  const addCode = (str, p) => { const c = designCode(str); if (c) { if (!codeIndex.has(c)) codeIndex.set(c, []); if (!codeIndex.get(c).includes(p)) codeIndex.get(c).push(p); } };
  const addNums = (sig, p) => { sig.numSet.forEach((n) => { if (!numIndex.has(n)) numIndex.set(n, []); if (!numIndex.get(n).includes(p)) numIndex.get(n).push(p); }); };
  (catalog || []).forEach((p) => {
    const k = normKey(p.name); if (k && !idx.has(k)) idx.set(k, p);
    addCode(p.name, p);
    const sig = nameSignature(p.name); p.__sig = sig; addNums(sig, p);
    (p.aliases || []).forEach((a) => { const ak = normKey(a); if (ak && !idx.has(ak)) idx.set(ak, p); addCode(a, p); addNums(nameSignature(a), p); });
  });
  idx.codeIndex = codeIndex;
  idx.numIndex = numIndex;
  return idx;
}
export function matchProduct(raw, catalog, idx) {
  const key = normKey(raw);
  if (!key || !catalog || !catalog.length) return { status: 'new', product: null, score: 0 };
  if (idx && idx.has(key)) return { status: 'match', product: idx.get(key), score: 1 };

  // 1) Design code (number + suffix, trailing digit kept) — precise for the
  //    prefix/NUMBER-SUFFIX formats (OV/632-DA, 152-CC, 88915 FL1).
  const code = designCode(raw);
  if (code && idx && idx.codeIndex && idx.codeIndex.has(code)) {
    const cands = idx.codeIndex.get(code);
    if (cands.length === 1) return { status: 'match', product: cands[0], score: 0.98 };
    let best = cands[0], bestS = 0; // several variants share the code — pick the closest
    cands.forEach((p) => { const s = simRatio(key, normKey(p.name)); if (s > bestS) { bestS = s; best = p; } });
    return { status: 'fuzzy', product: best, score: Math.max(0.86, bestS) };
  }

  // 2) Signature: anchor on the design NUMBER, disambiguate by CODE tokens.
  //    Robust to word order and prefix/suffix differences (handles "ZG 3147"
  //    where the code precedes the number). Confident 'match' only when the
  //    number matches AND every query code is present in one unique candidate;
  //    a partial hit is a reviewable 'fuzzy'; a same-number/different-code line
  //    is NOT this item and falls through.
  const q = nameSignature(raw);
  if (q.designNum && idx && idx.numIndex && idx.numIndex.has(q.designNum)) {
    const cands = idx.numIndex.get(q.designNum);
    let best = null, bestOv = -1, bestSim = -1, ties = 0;
    cands.forEach((p) => {
      const s = p.__sig || nameSignature(p.name);
      let ov = 0; q.codeSet.forEach((c) => { if (s.codeSet.has(c)) ov++; });
      const sim = simRatio(key, normKey(p.name));
      if (ov > bestOv + 1e-9 || (Math.abs(ov - bestOv) < 1e-9 && sim > bestSim + 1e-9)) { bestOv = ov; bestSim = sim; best = p; ties = 1; }
      else if (Math.abs(ov - bestOv) < 1e-9 && Math.abs(sim - bestSim) < 1e-9) { ties++; }
    });
    if (best && bestOv > 0) {
      const qc = q.codeSet.size;
      if (qc > 0 && bestOv === qc && ties === 1) return { status: 'match', product: best, score: 0.95 };
      return { status: 'fuzzy', product: best, score: 0.8 };
    }
  }

  // 3) Generic fuzzy fallback — for plain-text catalogs with no design codes.
  let best = null, bestScore = 0;
  catalog.forEach((p) => {
    [normKey(p.name), ...(p.aliases || []).map(normKey)].forEach((k) => {
      if (!k) return;
      const s = Math.max(simRatio(key, k), tokenJaccard(key, k) * 0.96, coverage(k, key) * 0.9);
      if (s > bestScore) { bestScore = s; best = p; }
    });
  });
  if (best && bestScore >= 0.84) return { status: 'fuzzy', product: best, score: bestScore };
  return { status: 'new', product: null, score: bestScore };
}
function findProduct(name, catalog, idx) {
  return idx ? idx.get(normKey(name)) : (catalog || []).find((x) => normKey(x.name) === normKey(name));
}
// All racks an item is kept in (first = primary). Falls back to the legacy
// single `rack` field for catalogs saved before the multi-rack change.
export function productRacks(name, catalog, idx) {
  const p = findProduct(name, catalog, idx);
  if (!p) return [];
  return (p.racks && p.racks.length) ? p.racks : (p.rack ? [p.rack] : []);
}
export function productVendors(name, catalog, idx) {
  const p = findProduct(name, catalog, idx);
  if (!p) return [];
  return (p.vendors && p.vendors.length) ? p.vendors : (p.vendor ? [p.vendor] : []);
}
// Primary rack (used to auto-fill on receipt).
export function productRack(name, catalog, idx) {
  return productRacks(name, catalog, idx)[0] || '';
}

// ---- line assembly + quantity ----
// Document boilerplate found on dispatch slips / challans — never item rows.
const JUNK_RE = /(lessstock|less\s*stock|pack\s*list|delivery\s*challan|challan|gstin|vehicle\s*no|l\.?\s*r\.?\s*no|driver|billing\s*address|delivery\s*address|kempegowda|maheshwari|temple|jaipur|rajasthan|gagwana|bangalore|banglore|karnataka|sequence\s*surfaces|customer\b|city\s*:|state\s*:|refparty|sales\s*exic|zone\b|level\s*:|transport\b|remark\b|truck\b|inv\s*no|aprox|weight|sub\s*total|grand\s*total|category|series\s*total|size\s*sub|total\s*sheets|freight|insurance|colordesk|woodpaper|dic-?continue|number\s*:|date\s*:|p\.?\s*o\.?|folder|box\s*:|design\s*name|grade\b|page\b|digital\b|std\s+gold|pre\s+std|taxture|taxure|texture|\bllp\b|industries)/i;
// Pure dimension lines like "MM 2440 MM X 1220 MM".
const SIZE_LINE = /^\s*(mm\s+)?\d+\s*mm(\s*x\s*\d+\s*mm)?\s*(sp)?\s*$/i;
const NAME_DROP = /\b(LAMINATE|SHEET|DECORATIVE|TYPE|MAKERS|COLORDESK|WOODPAPER|DISPATCH|PRE|STD|GOLD|ECO|TOTAL|SP|A|B)\b/gi;

const lineNums = (s) => [...(s || '').matchAll(/\d[\d,]*/g)].map((x) => parseInt(x[0].replace(/,/g, ''), 10)).filter((v) => v > 0 && v < 100000);
const lastNumber = (s) => { const m = lineNums(s); return m.length ? m[m.length - 1] : null; };
// Quantity = the last plain number on the line that isn't the design number
// (thickness/size already stripped).
function qtyFromLine(raw) {
  const sig = nameSignature(raw);
  const nums = lineNums(stripThickSize(clean(raw))).filter((v) => String(v) !== sig.designNum);
  return nums.length ? nums[nums.length - 1] : null;
}
// A real item row has both a design number and a code token.
function hasIdentity(raw) { const s = nameSignature(raw); return !!s.designNum && s.codeSet.size > 0; }
const isNumbersOnly = (raw) => (raw.match(/[A-Za-z]/g) || []).length < 2;
// A readable name for a NEW (unmatched) item: strip serial/thickness/size/qty and
// the obvious boilerplate words, keeping the design number + code.
function candidateName(raw) {
  let t = (raw || '').replace(/\s+/g, ' ').trim().toUpperCase();
  t = t.replace(/^\s*\d{1,4}[.)]?\s+/, '');
  t = t.replace(/\d*\.?\d+\s*MM\b/g, ' ');
  t = t.replace(/\(?\s*\d+\s*[X*]\s*\d+\s*\)?/g, ' ');
  t = t.replace(NAME_DROP, ' ');
  const sig = nameSignature(raw);
  t = t.split(/\s+/).filter((w) => (/^\d+$/.test(w) ? w === sig.designNum : true)).join(' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length >= 2 ? t : (raw || '').replace(/\s+/g, ' ').trim();
}

// Assemble raw PDF/paste lines into item rows. Junk and dimension lines are
// dropped; a numbers-only line (a split serial+qty continuation) supplies the
// quantity for the item row above it — so formats that put the qty on its own
// line still import with the right quantity.
function assemble(lines) {
  const items = [];
  for (const raw of (lines || [])) {
    const line = (raw || '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (JUNK_RE.test(line) || SIZE_LINE.test(line)) continue;
    if (hasIdentity(line)) {
      items.push({ raw: line, qty: qtyFromLine(line), nums: lineNums(line) });
    } else if (isNumbersOnly(line) && items.length && items[items.length - 1].qty == null) {
      const q = lastNumber(line); if (q != null) items[items.length - 1].qty = q;
    }
  }
  return items;
}

// Turn raw lines into review rows with catalog matches applied.
export function buildReview(lines, catalog, idx) {
  return assemble(lines).map((it) => {
    const mm = matchProduct(it.raw, catalog, idx);
    const r = { raw: candidateName(it.raw), qty: it.qty == null ? '' : it.qty, nums: it.nums || [], include: true, status: mm.status, score: mm.score, product: mm.product || null };
    if (mm.product) { r.name = mm.product.name; r.rack = productRack(mm.product.name, catalog, idx) || ''; }
    else { r.name = r.raw; r.rack = ''; }
    r.addToMaster = r.status === 'new';
    return r;
  });
}

export async function parsePdf(file) {
  if (!window.pdfjsLib) throw new Error('PDF reader not loaded');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p); const tc = await page.getTextContent();
    const byY = {};
    tc.items.forEach((it) => { if (!it.str.trim()) return; const y = Math.round(it.transform[5] / 3) * 3; (byY[y] = byY[y] || []).push({ x: it.transform[4], s: it.str }); });
    Object.keys(byY).map(Number).sort((a, b) => b - a).forEach((y) => {
      const l = byY[y].sort((a, b) => a.x - b.x).map((o) => o.s).join(' ').replace(/\s+/g, ' ').trim();
      if (l) lines.push(l);
    });
  }
  return lines;
}

// ---- Excel master read / write ----
const pickCol = (row, cands) => {
  for (const key of Object.keys(row)) {
    const kk = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cands.includes(kk)) return String(row[key] == null ? '' : row[key]).trim();
  }
  return '';
};
const sheetRows = (wb, names) => {
  const sn = wb.SheetNames.find((s) => names.includes(s.toLowerCase().trim()));
  return sn ? window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' }) : null;
};
const pushUniq = (arr, val) => {
  const s = (val || '').trim();
  if (s && !arr.some((x) => x.toUpperCase() === s.toUpperCase())) arr.push(s);
};
// First column's value — fallback for single-column sheets whose header we don't
// recognise (e.g. an "ITEM IST" or "RACK LIST" heading).
const firstCol = (r) => { const v = Object.values(r); return String(v.length ? v[0] : '').trim(); };

// Reads a master workbook. Items, racks and vendors are three lists:
//   Products/Items — item names (+ optional Aliases, Unit)
//   Racks          — the global pool of bins; a plain single-column list, OR a
//                    "Product Name + Rack" layout to also pin racks to an item
//   Vendors        — the vendor pool; single-column, OR "Product Name + Vendor"
// Returns { products, vendors, racks } where racks/vendors are the global pools.
// Tab names are flexible (Products/Items, Racks/Rack, Vendors/Vendor) and a
// single unknown column falls back to its first column, so a plain
// ITEMS / RACK / VENDOR workbook imports without reshaping.
export async function readWorkbook(file) {
  if (!window.XLSX) throw new Error('Spreadsheet reader not loaded');
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  let prod = sheetRows(wb, ['products', 'product', 'items', 'item', 'itemlist', 'itemist']);
  const rackRows = sheetRows(wb, ['racks', 'rack', 'racklist']);
  const vendRows = sheetRows(wb, ['vendors', 'vendor']);
  if (!prod) prod = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  const products = [];
  const byKey = new Map();
  // Key catalog identity by `norm` (the same normalization the server uses for
  // normName) so client and server agree on what counts as a distinct item —
  // punctuation-only differences stay separate instead of being merged away.
  const ensure = (name) => {
    const k = norm(name);
    if (byKey.has(k)) return byKey.get(k);
    const p = { name: name.trim(), racks: [], vendors: [], aliases: [], unit: '', vendorName: '', pid: '', pdid: '' };
    byKey.set(k, p); products.push(p); return p;
  };

  (prod || []).forEach((r) => {
    const name = pickCol(r, ['productname', 'product', 'name', 'item', 'items', 'itemlist', 'itemist', 'itemname', 'particulars', 'description']) || firstCol(r);
    if (!name) return;
    const p = ensure(name);
    const aliasRaw = pickCol(r, ['aliases', 'alias', 'altnames', 'altname', 'codes', 'code', 'othernames']);
    if (aliasRaw) aliasRaw.split(/[;,|/]+/).map((s) => s.trim()).filter(Boolean).forEach((a) => pushUniq(p.aliases, a));
    const unit = pickCol(r, ['unit', 'uom']); if (unit && !p.unit) p.unit = unit;
    // Extra master-sheet columns: vendor/factory name, product ids.
    const vName = pickCol(r, ['vendorname', 'factory', 'factoryname', 'supplier']); if (vName && !p.vendorName) p.vendorName = vName;
    const pid = pickCol(r, ['pid', 'productid', 'itemid']); if (pid && !p.pid) p.pid = pid;
    const pdid = pickCol(r, ['pdid', 'productdesignid', 'pdesignid']); if (pdid && !p.pdid) p.pdid = pdid;
    // Fold in legacy inline columns if present.
    pushUniq(p.racks, pickCol(r, ['defaultrack', 'rack', 'rackno', 'racknumber']));
    pushUniq(p.vendors, pickCol(r, ['vendor', 'vendorname', 'supplier']));
  });

  const racks = [];
  (rackRows || []).forEach((r) => {
    const name = pickCol(r, ['productname', 'product', 'item', 'particulars', 'description']);
    const rack = pickCol(r, ['racknumber', 'rackno', 'rack', 'racklist', 'defaultrack', 'bin', 'location']) || firstCol(r);
    if (!rack) return;
    pushUniq(racks, rack);                       // every rack joins the global pool
    if (name) pushUniq(ensure(name).racks, rack); // and, if named, pins to the item
  });

  const vendors = [];
  (vendRows || []).forEach((r) => {
    const name = pickCol(r, ['productname', 'product', 'item', 'particulars', 'description']);
    const vend = pickCol(r, ['vendorname', 'vendor', 'supplier', 'name']) || firstCol(r);
    if (!vend) return;
    pushUniq(vendors, vend);
    if (name) pushUniq(ensure(name).vendors, vend);
  });

  // Fold any per-item racks/vendors into the global pools too.
  products.forEach((p) => { p.racks.forEach((x) => pushUniq(racks, x)); p.vendors.forEach((x) => pushUniq(vendors, x)); });
  return { products, vendors, racks };
}

// Exports the current masters back to a workbook: Products (name/aliases/unit),
// Racks (the global bin pool, one per row) and Vendors (the vendor pool).
export function downloadWorkbook(catalog, vendors, racks, filename) {
  if (!window.XLSX) throw new Error('Spreadsheet engine not loaded');
  const cat = catalog || [];
  const racksOf = (p) => (p.racks && p.racks.length) ? p.racks : (p.rack ? [p.rack] : []);
  const vendorsOf = (p) => (p.vendors && p.vendors.length) ? p.vendors : (p.vendor ? [p.vendor] : []);

  const products = [['Product Name', 'Aliases', 'Unit', 'Vendor Name', 'PID', 'PDID'],
    ...cat.map((p) => [p.name, (p.aliases || []).join('; '), p.unit || '', p.vendorName || '', p.pid || '', p.pdid || ''])];

  const rackPool = [];
  (racks || []).forEach((r) => pushUniq(rackPool, r));
  cat.forEach((p) => racksOf(p).forEach((r) => pushUniq(rackPool, r)));
  const rackRows = [['Rack Number'], ...rackPool.map((r) => [r])];

  const vendPool = [];
  (vendors || []).forEach((v) => pushUniq(vendPool, v));
  cat.forEach((p) => vendorsOf(p).forEach((v) => pushUniq(vendPool, v)));
  const vendRows = [['Vendor Name'], ...vendPool.map((v) => [v])];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(products), 'Products');
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rackRows), 'Racks');
  window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(vendRows), 'Vendors');
  window.XLSX.writeFile(wb, filename || 'grn-master.xlsx');
}

// Export a set of GRNs to one workbook: a Summary sheet listing them all, then
// one sheet per GRN with its header + item table (racks, expected, received,
// variance). Sheet names use the GRN number (sanitised + de-duped for Excel).
export function downloadGrnWorkbook(grns, filename) {
  if (!window.XLSX) throw new Error('Spreadsheet engine not loaded');
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const list = grns || [];

  // Short/over is computed per ITEM (netting an item's bin lines together), so
  // an item split across racks reconciles as a whole — matching each GRN sheet.
  const totals = (items) => {
    const map = new Map();
    (items || []).forEach((it) => {
      const k = norm(it.name);
      if (!map.has(k)) map.set(k, { exp: null, rec: 0 });
      const m = map.get(k); m.rec += +it.received || 0;
      if (it.expected != null) m.exp = (m.exp || 0) + (+it.expected || 0);
    });
    let exp = 0, rec = 0, short = 0, over = 0;
    map.forEach((m) => { rec += m.rec; if (m.exp != null) { exp += m.exp; const d = m.rec - m.exp; if (d < 0) short += -d; else over += d; } });
    return { exp, rec, short, over };
  };

  // Summary sheet
  const sum = [['GRN No', 'Date', 'Vendor / Factory', 'Bill No', 'Status', 'Items', 'Expected', 'Received', 'Short', 'Over']];
  list.forEach((g) => {
    const items = g.items || [];
    const distinct = new Set(items.map((it) => norm(it.name))).size;
    const t = totals(items);
    sum.push([g.grnNo, fmtDate(g.date), g.vendor || '', g.billNo || '', g.status === 'done' ? 'RECEIVED' : 'DRAFT', distinct, t.exp, t.rec, t.short, t.over]);
  });
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sum), 'Summary');

  // Unique, Excel-safe sheet names
  const used = new Set(['summary']);
  const sheetName = (base, i) => {
    let n = String(base || ('GRN ' + (i + 1))).replace(/[\\/?*[\]:]/g, '-').slice(0, 28).trim() || ('GRN ' + (i + 1));
    let name = n, k = 1;
    while (used.has(name.toLowerCase())) { name = (n.slice(0, 24) + ' (' + (++k) + ')'); }
    used.add(name.toLowerCase());
    return name;
  };

  const GREEN = '8BB04F', RED = 'E0523B';
  const fillStyle = (rgb) => ({ fill: { patternType: 'solid', fgColor: { rgb } }, font: { bold: true, color: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center' } });

  list.forEach((g, gi) => {
    const items = g.items || [];
    const map = new Map();
    for (const it of items) { const key = norm(it.name); if (!map.has(key)) map.set(key, { name: it.name, lines: [] }); map.get(key).lines.push(it); }
    const groups = [...map.values()];
    const hasExp = items.some((it) => it.expected != null);

    const head = [
      ['GRN No', g.grnNo], ['Date', fmtDate(g.date)], ['Vendor / Factory', g.vendor || ''],
      ['Bill / Invoice No', g.billNo || ''], ['Status', g.status === 'done' ? 'RECEIVED' : 'DRAFT'], [],
    ];
    const aoa = [...head, hasExp ? ['#', 'Particulars', 'Rack — qty', 'Expected', 'Received', 'Variance'] : ['#', 'Particulars', 'Rack — qty', 'Received']];
    const merges = [];      // merge the item-level columns across an item's rack rows
    const styled = [];      // {r, c, rgb} variance colour fills
    let tExp = 0, tRec = 0, num = 0;

    groups.forEach((grp) => {
      const lines = grp.lines.length ? grp.lines : [{ rack: '', received: 0 }];
      const rec = grp.lines.reduce((s, l) => s + (+l.received || 0), 0);
      const expLines = grp.lines.filter((l) => l.expected != null);
      const hasE = expLines.length > 0;
      const exp = expLines.reduce((s, l) => s + (+l.expected || 0), 0);
      tRec += rec; tExp += hasE ? exp : 0;
      const d = hasE ? rec - exp : null;
      num += 1;
      const start = aoa.length;
      const multi = lines.length > 1;
      lines.forEach((l, li) => {
        // one rack per row (with its own qty when the item is split across racks)
        const rackText = `${l.rack || '—'}${multi ? ' — ' + (+l.received || 0) : ''}`;
        if (li === 0) {
          aoa.push(hasExp ? [num, grp.name, rackText, hasE ? exp : '', rec, d == null ? '' : Math.abs(d)] : [num, grp.name, rackText, rec]);
        } else {
          aoa.push(hasExp ? ['', '', rackText, '', '', ''] : ['', '', rackText, '']);
        }
      });
      const end = aoa.length - 1;
      if (multi) (hasExp ? [0, 1, 3, 4, 5] : [0, 1, 3]).forEach((c) => merges.push({ s: { r: start, c }, e: { r: end, c } }));
      if (hasExp && hasE && d !== 0) styled.push({ r: start, c: 5, rgb: d > 0 ? GREEN : RED });
    });

    aoa.push(hasExp ? ['', 'TOTAL', '', tExp, tRec, ''] : ['', 'TOTAL', '', tRec]);

    const ws = X.utils.aoa_to_sheet(aoa);
    if (merges.length) ws['!merges'] = merges;
    ws['!cols'] = hasExp ? [{ wch: 5 }, { wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }] : [{ wch: 5 }, { wch: 28 }, { wch: 20 }, { wch: 10 }];
    // colour the variance cells (green = over, red = short)
    styled.forEach((sc) => { const a = X.utils.encode_cell({ r: sc.r, c: sc.c }); if (ws[a]) ws[a].s = fillStyle(sc.rgb); });
    // vertically centre the merged item cells so they sit beside their rack rows
    merges.forEach((m) => { const a = X.utils.encode_cell(m.s); if (ws[a] && !ws[a].s) ws[a].s = { alignment: { vertical: 'center', horizontal: m.s.c === 1 ? 'left' : 'center' } }; });
    X.utils.book_append_sheet(wb, ws, sheetName(g.grnNo, gi));
  });

  X.writeFile(wb, filename || 'grn-report.xlsx');
}

export function downloadTemplate() {
  downloadWorkbook(
    [
      { name: 'VN 9401 ZA VNEXC (P)', aliases: [], unit: 'pcs' },
      { name: 'GM 9339 SB (PRE) (9x4)', aliases: [], unit: 'pcs' },
      { name: 'AC 05 ACRSOL', aliases: [], unit: 'pcs' },
    ],
    ['Vansh Laminate LLP', 'Ajmer Industries LLP', 'OTHER'],
    ['A/01-01(A)', 'A/01-01(B)', 'A/01-02(A)', 'G/16-04(C)'],
    'grn-master-template.xlsx'
  );
}

// (number/date formatting helpers used across the UI)
export const nf = new Intl.NumberFormat('en-IN');
export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export function variance(it) {
  if (it.expected == null) return null;
  const rec = +it.received || 0, exp = +it.expected || 0, d = rec - exp;
  if (rec === 0) return { cls: 'wait', txt: 'awaiting' };
  if (d === 0) return { cls: 'ok', txt: '✓ matched' };
  if (d < 0) return { cls: 'short', txt: 'short ' + nf.format(-d) };
  return { cls: 'over', txt: 'over ' + nf.format(d) };
}

// ---- printing (shared by the Editor and the dashboard's per-card Print) ----
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function groupItems(lines) {
  const map = new Map();
  for (const it of lines || []) { const key = norm(it.name); if (!map.has(key)) map.set(key, { key, name: it.name, lines: [] }); map.get(key).lines.push(it); }
  return [...map.values()];
}
// Render a GRN into #printArea and open the browser print dialog. Works from any
// screen — the print stylesheet hides the app and shows only #printArea.
export function printGrnDoc(grn) {
  const area = typeof document !== 'undefined' && document.getElementById('printArea');
  if (!area || !grn) return;
  const items = grn.items || [];
  const hasExp = items.some((it) => it.expected != null);
  const totRec = items.reduce((s, it) => s + (+it.received || 0), 0);
  const totExp = items.reduce((s, it) => s + (it.expected != null ? +it.expected || 0 : 0), 0);
  const head = hasExp
    ? `<tr><th class="c" style="width:34px">#</th><th>Particulars</th><th class="c" style="width:74px">Rack</th><th class="r" style="width:64px">Exp.</th><th class="r" style="width:64px">Recd.</th><th class="c" style="width:64px">Var.</th></tr>`
    : `<tr><th class="c" style="width:36px">#</th><th>Particulars</th><th class="c" style="width:90px">Rack</th><th class="r" style="width:90px">Qty</th></tr>`;
  const groups = groupItems(items);
  const rackText = (grp) => grp.lines.map((l) => `${l.rack || '—'}${grp.lines.length > 1 ? ' (' + nf.format(l.received || 0) + ')' : ''}`).join(', ');
  const rows = groups.map((grp, i) => {
    const rec = grp.lines.reduce((s, l) => s + (+l.received || 0), 0);
    const expLines = grp.lines.filter((l) => l.expected != null);
    const hasE = expLines.length > 0;
    const exp = expLines.reduce((s, l) => s + (+l.expected || 0), 0);
    if (hasExp) { const d = hasE ? rec - exp : null; const vt = d == null ? '—' : d === 0 ? 'OK' : d < 0 ? '-' + nf.format(-d) : '+' + nf.format(d);
      return `<tr><td class="c">${i + 1}</td><td>${escHtml(grp.name)}</td><td class="c">${escHtml(rackText(grp))}</td><td class="r">${hasE ? nf.format(exp) : '—'}</td><td class="r">${nf.format(rec)}</td><td class="c">${vt}</td></tr>`; }
    return `<tr><td class="c">${i + 1}</td><td>${escHtml(grp.name)}</td><td class="c">${escHtml(rackText(grp))}</td><td class="r">${nf.format(rec)}</td></tr>`;
  }).join('');
  const foot = hasExp
    ? `<tr class="p-tot"><td colspan="3">TOTAL — ${groups.length} item(s)</td><td class="r">${nf.format(totExp)}</td><td class="r">${nf.format(totRec)}</td><td class="c"></td></tr>`
    : `<tr class="p-tot"><td colspan="2">TOTAL — ${groups.length} item(s)</td><td class="c"></td><td class="r">${nf.format(totRec)}</td></tr>`;
  area.innerHTML = `<div class="p-doc">
    <div class="p-title"><h1>GOODS RECEIVED NOTE</h1><div class="pno">${escHtml(grn.grnNo)}<br><span style="font-weight:400;font-size:11px">${grn.status === 'done' ? 'RECEIVED' : 'DRAFT'}</span></div></div>
    <div class="p-fields"><div><span>Vendor / Factory</span><b>${escHtml(grn.vendor || '—')}</b></div><div><span>Date</span><b>${escHtml(fmtDate(grn.date) || '—')}</b></div><div><span>Bill / Invoice No</span><b>${escHtml(grn.billNo || '—')}</b></div></div>
    <table class="p-items"><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>
    <div class="p-sign"><div>Received by</div><div>Checked by</div><div>Purchase dept</div></div></div>`;
  window.print();
}
