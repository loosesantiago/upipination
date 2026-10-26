'use strict';
// Password hashing with Node's built-in scrypt (no native add-ons needed).
const crypto = require('crypto');

const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEYLEN = 64;

function hash(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(password).normalize('NFKC'), salt, KEYLEN, PARAMS, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

function verify(password, stored) {
  return new Promise(resolve => {
    const [type, salt, key] = String(stored || '').split('$');
    if (type !== 'scrypt' || !salt || !key) return resolve(false);
    const expected = Buffer.from(key, 'base64');
    crypto.scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, PARAMS, (err, derived) => {
      resolve(!err && derived.length === expected.length && crypto.timingSafeEqual(derived, expected));
    });
  });
}

module.exports = { hash, verify };
