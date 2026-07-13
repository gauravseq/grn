// Boots the real Express+Mongoose server against an in-memory MongoDB and
// exercises the API end to end.
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');

const assert = (c, m) => { if (!c) { console.error('✗ FAIL:', m); process.exitCode = 1; throw new Error(m); } console.log('✓', m); };

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret';
  process.env.PORT = '5055';

  require('./index'); // connects + listens
  const base = 'http://localhost:5055';
  // wait for health
  for (let i = 0; i < 50; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch (e) {} await new Promise((r) => setTimeout(r, 200)); }

  // create first admin directly
  const User = require('./models/User');
  await User.create({ username: 'admin', passwordHash: await bcrypt.hash('admin123', 10), fullName: 'Admin', role: 'admin' });

  const call = async (path, opts = {}, tok) => {
    const res = await fetch(base + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  let r = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert(r.status === 200 && r.body.token, 'admin can log in');
  const tok = r.body.token;
  assert((await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'no' } })).status === 401, 'wrong password rejected');

  // seed catalog via bulk (as admin)
  r = await call('/api/masters/products/bulk', { method: 'POST', body: { replace: true, vendors: ['Acme Factory'], products: [
    { name: 'M8 Hex Bolt Zinc', rack: 'A-12', aliases: ['M8 BOLT ZN'] },
    { name: 'Washer 8mm SS', rack: 'A-13', aliases: [] },
  ] } }, tok);
  assert(r.body.products === 2, 'catalog bulk-loaded (2 products)');
  r = await call('/api/masters/products', {}, tok);
  assert(r.body.length === 2 && r.body[0].rack, 'catalog readable with racks');

  // multi-rack / multi-vendor: arrays are stored, legacy single fields still accepted
  await call('/api/masters/products/bulk', { method: 'POST', body: { vendors: ['Acme Factory', 'Bharat Fasteners'], products: [
    { name: 'M8 Hex Bolt Zinc', racks: ['A-12', 'A-14'], vendors: ['Acme Factory', 'Bharat Fasteners'], aliases: ['M8 BOLT ZN'] },
    { name: 'Washer 8mm SS', rack: 'A-13' },
  ] } }, tok);
  r = await call('/api/masters/products', {}, tok);
  const mb = r.body.find((p) => p.name === 'M8 Hex Bolt Zinc');
  assert(mb.racks.length === 2 && mb.racks[0] === 'A-12', 'item keeps multiple racks (primary first)');
  assert(mb.vendors.length === 2 && mb.vendors.includes('Bharat Fasteners'), 'item keeps multiple vendors');
  assert(mb.rack === 'A-12' && mb.vendor === 'Acme Factory', 'derived primary rack/vendor still exposed');
  const wb = r.body.find((p) => p.name === 'Washer 8mm SS');
  assert(wb.racks.length === 1 && wb.rack === 'A-13', 'legacy single rack folded into the racks list');

  // global rack pool (bins independent of items)
  await call('/api/masters/products/bulk', { method: 'POST', body: { racks: ['A/01-01(A)', 'A/01-02(B)', 'G/16-04(C)'], products: [{ name: 'M8 Hex Bolt Zinc' }], vendors: [] } }, tok);
  r = await call('/api/masters/racks', {}, tok);
  assert(Array.isArray(r.body) && r.body.length === 3 && r.body.includes('G/16-04(C)'), 'global rack pool loaded (3 bins)');

  r = await call('/api/grns', { method: 'POST' }, tok);
  assert(r.status === 200 && /^GRN-000\d\d$/.test(r.body.grnNo), 'GRN created ' + r.body.grnNo);
  const gid = r.body.id;

  r = await call('/api/grns/' + gid, { method: 'PATCH', body: { vendor: 'Acme Factory', billNo: 'INV-1' } }, tok);
  assert(r.body.vendor === 'Acme Factory', 'header saved');

  r = await call('/api/grns/' + gid + '/import', { method: 'POST', body: { rows: [
    { name: 'M8 Hex Bolt Zinc', qty: 100, rack: 'A-12' }, { name: 'Washer 8mm SS', qty: 500 }, { name: 'M8 Hex Bolt Zinc', qty: 50 },
  ] } }, tok);
  const bolt = r.body.items.find((i) => i.name === 'M8 Hex Bolt Zinc');
  assert(bolt.expected === 150, 'duplicate import merged expected → 150');
  assert(r.body.items.length === 2, 'two distinct expected lines');

  // re-uploading the SAME list must be idempotent — expected must not double/triple
  r = await call('/api/grns/' + gid + '/import', { method: 'POST', body: { rows: [
    { name: 'M8 Hex Bolt Zinc', qty: 100, rack: 'A-12' }, { name: 'Washer 8mm SS', qty: 500 }, { name: 'M8 Hex Bolt Zinc', qty: 50 },
  ] } }, tok);
  const boltRe = r.body.items.find((i) => i.name === 'M8 Hex Bolt Zinc');
  assert(boltRe.expected === 150, 're-import does NOT double expected (idempotent, still 150)');
  assert(r.body.items.length === 2, 're-import created no duplicate lines');

  await call('/api/grns/' + gid + '/lines', { method: 'POST', body: { name: 'M8 Hex Bolt Zinc', qty: 60, rack: 'A-12' } }, tok);
  r = await call('/api/grns/' + gid + '/lines', { method: 'POST', body: { name: 'm8  hex bolt  zinc', qty: 40, rack: 'A-12' } }, tok);
  const b2 = r.body.items.find((i) => i.name.toUpperCase().replace(/\s+/g, ' ') === 'M8 HEX BOLT ZINC');
  assert(b2 && b2.received === 100, 'same item+bin stacked across case/space → 100');
  assert(r.body.items.length === 2, 'stacking the same bin created no duplicate line');

  r = await call('/api/grns/' + gid + '/lines', { method: 'POST', body: { name: 'Lock Washer 10mm', qty: 5 } }, tok);
  const walk = r.body.items.find((i) => i.name === 'Lock Washer 10mm');
  assert(walk.expected === null && walk.received === 5, 'walk-in item: no expected, received 5');

  // walk-in learned into catalog, and the receipt tags it with the GRN's vendor
  r = await call('/api/masters/products', {}, tok);
  const lw = r.body.find((p) => p.name === 'Lock Washer 10mm');
  assert(lw, 'walk-in item learned into catalog');
  assert(lw.vendors.includes('Acme Factory'), 'receipt learned the GRN vendor onto the item');

  const boltLine = (await call('/api/grns/' + gid, {}, tok)).body.items.find((i) => i.name.toUpperCase().replace(/\s+/g, ' ') === 'M8 HEX BOLT ZINC');
  r = await call('/api/grns/' + gid + '/lines/' + boltLine.id + '/add', { method: 'POST', body: { qty: 50 } }, tok);
  const b3 = r.body.items.find((i) => i.id === boltLine.id);
  assert(b3.received === 150, 'quick-add → received 150 (matches expected)');
  assert(b3.log.length === 3, 'unload log has 3 additions');

  r = await call('/api/grns/' + gid, { method: 'PATCH', body: { status: 'done' } }, tok);
  assert(r.body.status === 'done', 'GRN marked received');

  r = await call('/api/grns', {}, tok);
  const sum = r.body.find((g) => g.id === gid);
  assert(sum.items === 3 && sum.totalQty === 155, 'dashboard totals correct (3 items, 155 received)');

  // concurrency: many simultaneous receipts of the same item must all land
  // (regression test for lost updates from read-modify-save races).
  r = await call('/api/grns', { method: 'POST' }, tok);
  const cid = r.body.id;
  const N = 12;
  await Promise.all(Array.from({ length: N }, () =>
    call('/api/grns/' + cid + '/lines', { method: 'POST', body: { name: 'Race Bolt', qty: 1 } }, tok)));
  r = await call('/api/grns/' + cid, {}, tok);
  const race = r.body.items.find((i) => i.name === 'Race Bolt');
  assert(r.body.items.length === 1, 'concurrent adds made a single line (no duplicates)');
  assert(race && race.received === N, `all ${N} concurrent receipts counted (received ${race && race.received})`);
  assert(race && race.log.length === N, `unload log recorded all ${N} additions`);
  await call('/api/grns/' + cid, { method: 'DELETE' }, tok);

  // per-bin lines: same item into different racks stays separate (bins keep own qty)
  r = await call('/api/grns', { method: 'POST' }, tok);
  const bid = r.body.id;
  await call('/api/grns/' + bid + '/lines', { method: 'POST', body: { name: 'VN 773 ZA VNSTX', qty: 60, rack: 'A/01-01(A)' } }, tok);
  await call('/api/grns/' + bid + '/lines', { method: 'POST', body: { name: 'VN 773 ZA VNSTX', qty: 40, rack: 'A/01-02(B)' } }, tok);
  r = await call('/api/grns/' + bid + '/lines', { method: 'POST', body: { name: 'VN 773 ZA VNSTX', qty: 15, rack: 'A/01-01(A)' } }, tok);
  const bins = r.body.items.filter((i) => i.name === 'VN 773 ZA VNSTX');
  assert(bins.length === 2, 'same item in two bins → two separate lines');
  const binA = bins.find((l) => l.rack === 'A/01-01(A)'), binB = bins.find((l) => l.rack === 'A/01-02(B)');
  assert(binA && binA.received === 75, 'first bin stacked its own receipts (60+15=75), rack unchanged');
  assert(binB && binB.received === 40, 'second bin kept its own qty (40), not overwritten by the first');
  await call('/api/grns/' + bid, { method: 'DELETE' }, tok);

  // password minimum enforced
  assert((await call('/api/auth/register', { method: 'POST', body: { username: 'shorty', password: 'abc', role: 'dock' } }, tok)).status === 400, 'short password rejected on register');

  // role guard
  await call('/api/auth/register', { method: 'POST', body: { username: 'dock1', password: 'dockpass1', role: 'dock' } }, tok);
  const dtok = (await call('/api/auth/login', { method: 'POST', body: { username: 'dock1', password: 'dockpass1' } })).body.token;
  assert((await call('/api/grns/' + gid, { method: 'DELETE' }, dtok)).status === 403, 'dock blocked from deleting GRN');
  assert((await call('/api/masters/products/bulk', { method: 'POST', body: { products: [] } }, dtok)).status === 403, 'dock blocked from editing catalog');
  assert((await call('/api/grns/' + gid, { method: 'PATCH', body: { status: 'draft' } }, dtok)).status === 403, 'dock blocked from changing GRN status');
  assert((await call('/api/grns/' + gid, { method: 'DELETE' }, tok)).status === 200, 'admin can delete GRN');

  console.log('\nALL MERN END-TO-END TESTS PASSED');
  await mongod.stop();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
