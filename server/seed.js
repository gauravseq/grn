require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connect, mongoose } = require('./db');
const User = require('./models/User');
const Vendor = require('./models/Vendor');
const Product = require('./models/Product');
const { norm } = require('./helpers');

(async () => {
  try {
    await connect();
    if ((await User.countDocuments()) === 0) {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      await User.create({ username, passwordHash: await bcrypt.hash(password, 10), fullName: 'Administrator', role: 'admin' });
      console.log(`✓ Admin created — ${username} / ${password} (change this after first login)`);
    } else console.log('· Users already exist — skipping admin creation.');

    await Vendor.updateOne({ name: 'Sample Factory Vendor' }, { $setOnInsert: { name: 'Sample Factory Vendor' } }, { upsert: true });
    const items = [
      ['M8 Hex Bolt Zinc', 'A-12'], ['Washer 8mm SS', 'A-13'], ['Anchor Fastener 10x100', 'C-04'],
    ];
    for (const [name, rack] of items) {
      await Product.updateOne({ normName: norm(name) }, { $set: { name, rack }, $setOnInsert: { normName: norm(name), aliases: [] } }, { upsert: true });
    }
    console.log('✓ Sample vendor and products added.');
  } catch (e) { console.error('Seed failed:', e.message); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
