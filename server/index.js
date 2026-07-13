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

// Serve the built React client (client/dist) in production.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
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
    // Self-heal the hardcoded master catalog before serving (additive, never deletes).
    try { const r = await ensureMasters(); console.log(`✓ Master catalog ensured — ${r.products} items, ${r.racks} racks, ${r.vendors} vendors`); }
    catch (e) { console.error('⚠ Could not ensure master catalog:', e.message); }
    server.listen(PORT, () => console.log(`GRN Desk (MERN) on http://localhost:${PORT}`));
  })
  .catch((e) => { console.error('Mongo connection failed:', e.message); process.exit(1); });

module.exports = app;
