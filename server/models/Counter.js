const { Schema, model } = require('mongoose');
const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
module.exports = model('Counter', CounterSchema);
