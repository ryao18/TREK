const crypto = require('crypto');

let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: No JWT_SECRET set — using auto-generated secret. Sessions will reset on server restart. Set JWT_SECRET for persistent sessions.');
}

module.exports = { JWT_SECRET };
