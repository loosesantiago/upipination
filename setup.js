#!/usr/bin/env node
'use strict';
// Sets (or changes) the group password. Only a one-way hash is stored, in data/config.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hash } = require('./lib/pw');

const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const CONFIG = path.join(DATA, 'config.json');

function askHidden(prompt) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    let value = '';
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  if (!process.stdin.isTTY) {
    console.error('Run this command in an interactive terminal.');
    process.exit(1);
  }
  console.log('\nUpipination: set the group password');
  console.log('It is never stored in plain text, only as a one-way hash.\n');
  const a = await askHidden('New group password (at least 10 characters): ');
  if (a.length < 10) { console.error('Too short. Nothing was changed.'); process.exit(1); }
  const b = await askHidden('Type it again: ');
  if (a !== b) { console.error('They do not match. Nothing was changed.'); process.exit(1); }

  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const config = {
    group: await hash(a),
    v: crypto.randomBytes(8).toString('hex'), // changing the password invalidates old "door" cookies
    updated: new Date().toISOString()
  };
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
  console.log(`\nSaved to ${CONFIG}`);
  console.log('Restart the server to apply it:  sudo systemctl restart upipination  (or run npm start again)\n');
})();
