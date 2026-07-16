// One-time reset: delete ALL GRNs so numbering restarts cleanly at GRN-001.
// Run once, from the server folder, with the same MONGODB_URI your server uses:
//     node reset-grns.js
// After this, the next note you Submit becomes GRN-001.
require('dotenv').config();
const { connect, mongoose } = require('./db');
const Grn = require('./models/Grn');

(async () => {
  try {
    await connect();
    const before = await Grn.countDocuments();
    const res = await Grn.deleteMany({});
    // The old monotonic counter is no longer used (numbering is derived from the
    // notes themselves now) — drop it so nothing lingers.
    try { await mongoose.connection.db.collection('counters').deleteOne({ _id: 'grn' }); } catch (e) {}
    console.log(`✓ Deleted ${res.deletedCount} GRN(s) (was ${before}). Next submitted GRN → GRN-001.`);
  } catch (e) {
    console.error('Reset failed:', e.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
