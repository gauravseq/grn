require('dotenv').config();
require('express-async-errors');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { connect } = require('./db');
const { ensureMasters } = require('./ensureMasters');

if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET is not set — using an insecure default. Set it before going live.');

const app = express();
const server = http.createServer(app);
const ORIGIN = process.env.CLIENT_ORIGIN || '*';
const io = new Server(server, { cors: { origin: ORIGIN } });
app.set('io', io);

// Mirror the socket policy: same-origin in production (Express serves the built
// client), or lock to CLIENT_ORIGIN when the API is hosted separately.
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/grns', require('./routes/grns'));
app.use('/api/masters', require('./routes/masters'));
app.use('/api/users', require('./routes/users'));

// Serve the built React client (client/dist) in production. CLIENT_DIST can point
// somewhere else (used to run a preview build side-by-side with the live one).
const clientDist = process.env.CLIENT_DIST || path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, nextFn) => {
  if (req.path.startsWith('/api')) return nextFn();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => { if (err) res.status(404).send('Client not built yet. Run: npm run build'); });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

io.on('connection', (socket) => {
  socket.on('join', (id) => socket.join('grn:' + id));
  socket.on('leave', (id) => socket.leave('grn:' + id));
});

const PORT = process.env.PORT || 5000;
connect()
  .then(async () => {
    // Seed the baked-in master baseline ONLY into an empty database. If any master
    // data exists it is left completely untouched, so deploying/restarting can
    // never resurrect deleted items or undo renames. RESTORE_MASTERS=1 forces it.
    try {
      const r = await ensureMasters({ force: process.env.RESTORE_MASTERS === '1' });
      if (r.skipped) console.log(`· Master lists untouched (${r.products} items, ${r.racks} racks, ${r.vendors} vendors already present)`);
      else console.log(`✓ Empty database — seeded baseline: ${r.products} items, ${r.racks} racks, ${r.vendors} vendors`);
    } catch (e) { console.error('⚠ Could not check master catalog:', e.message); }
    // Numbering used to be unique on seq alone. Splits deliberately SHARE their
    // parent's seq (GRN-001 / GRN-001 (A)), so that old index would reject every
    // split with a duplicate-key error. Drop it — mongoose builds the compound
    // {seq, suffix} replacement itself. Safe to run on every boot.
    try {
      const Grn = require('./models/Grn');
      const idx = await Grn.collection.indexes();
      if (idx.some((i) => i.name === 'seq_1')) {
        await Grn.collection.dropIndex('seq_1');
        console.log('· Dropped the old seq_1 index — GRN numbering is now {seq, suffix}');
      }
    } catch (e) { /* fresh DB / no collection yet — nothing to drop */ }
    // Sweep only long-abandoned UNSUBMITTED drafts (never numbered, never in the
    // list). Real GRNs always have a seq and are never touched.
    try {
      const Grn = require('./models/Grn');
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
      const r = await Grn.deleteMany({ seq: null, createdAt: { $lt: cutoff } });
      if (r.deletedCount) console.log(`· Cleared ${r.deletedCount} abandoned draft(s) older than 7 days`);
    } catch (e) { /* non-fatal */ }
    server.listen(PORT, () => console.log(`GRN Desk (MERN) on http://localhost:${PORT}`));
  })
  .catch((e) => { console.error('Mongo connection failed:', e.message); process.exit(1); });

module.exports = app;
