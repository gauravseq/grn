const mongoose = require('mongoose');
const dns = require('dns');

async function connect(uri) {
  const target = uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/grn';
  // A `mongodb+srv://` URI needs a DNS SRV lookup. Some networks' resolver
  // refuses SRV queries (Node throws `querySrv ECONNREFUSED`), so for SRV URIs
  // we point Node's resolver at public DNS. Override the servers with
  // DNS_SERVERS (comma-separated) or disable this entirely with DNS_SERVERS=off.
  if (target.startsWith('mongodb+srv://') && process.env.DNS_SERVERS !== 'off') {
    const servers = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (servers.length) { try { dns.setServers(servers); } catch (e) { /* ignore */ } }
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(target);
  console.log('✓ MongoDB connected');
}

module.exports = { connect, mongoose };
