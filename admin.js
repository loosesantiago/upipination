#!/usr/bin/env node
'use strict';
// Upipination admin tool. Run on the server PC:
//   sudo -u upipination node /opt/upipination/admin.js help
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { hash } = require('./lib/pw');

const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA, 'upipination.db');
const CONFIG = path.join(DATA, 'config.json');
const UP = path.join(DATA, 'uploads');
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm|mov)$/;

if (!fs.existsSync(DB_FILE)) { console.error(`Database not found at ${DB_FILE}`); process.exit(1); }
const db = new Database(DB_FILE);
db.pragma('foreign_keys = ON');

const [cmd, ...args] = process.argv.slice(2);
const arg = args.join(' ').trim();
const when = ts => new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });
const short = (s, n = 60) => { s = String(s || '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const nameOf = id => (db.prepare('SELECT name FROM users WHERE id = ?').get(id) || {}).name || '?';
const rmFile = f => { if (f && FILE_RE.test(f)) fs.rmSync(path.join(UP, f), { force: true }); };
const need = (v, usage) => { if (!v) { console.error('Usage: ' + usage); process.exit(1); } return v; };
const userBy = username => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).toLowerCase());
  if (!u) { console.error(`No user with username "${username}". Run: admin.js users`); process.exit(1); }
  return u;
};
const done = msg => console.log(msg + '\nFriends will see the change after refreshing the page.');

function askHidden(prompt) {
  return new Promise(resolve => {
    const stdin = process.stdin; let value = '';
    process.stdout.write(prompt);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write('\n'); resolve(value); return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1); else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const HELP = `
Upipination admin tool
Run as:  sudo -u upipination node /opt/upipination/admin.js <command>

GROUP PASSWORD (the first screen)
  group-password                 change the password everyone types to enter the site

USERS
  users                          list all accounts
  reset-password <username>      set a new password for someone (logs them out)
  rename <username> <new name>   change someone's display name
  remove-avatar <username>       remove someone's profile picture
  logout <username>              log someone out on all devices
  logout-all                     log everyone out
  delete-user <username>         delete an account AND everything they posted

POSTS
  posts [how many]               list recent posts with their ID
  delete-post <id>               delete a post (with its photos, videos and comments)
  comments <post id>             list comments of a post
  delete-comment <id>            delete one comment

CHAT
  chat [how many]                list recent chat messages with their ID
  delete-message <id>            delete one chat message
  clear-chat                     delete the whole chat history

EVENTS / ART / EMOJIS / GIFS
  events                         list events
  delete-event <id>
  art                            list art uploads
  delete-art <id>
  emojis                         list custom emojis
  delete-emoji <name>
  gifs                           list GIFs
  delete-gif <id>
`;

(async () => {
  switch (cmd) {
    case 'group-password': {
      if (!process.stdin.isTTY) { console.error('Run this in an interactive terminal.'); process.exit(1); }
      console.log('\nChange the GROUP password (the first screen of the site).');
      console.log('It is stored only as a one-way hash, never in plain text.\n');
      const a = await askHidden('New group password (at least 10 characters): ');
      if (a.length < 10 || a.length > 200) { console.error('Must be 10 to 200 characters. Nothing changed.'); process.exit(1); }
      const b = await askHidden('Type it again: ');
      if (a !== b) { console.error('They do not match. Nothing changed.'); process.exit(1); }
      const config = { group: await hash(a), v: crypto.randomBytes(8).toString('hex'), updated: new Date().toISOString() };
      fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
      db.prepare('DELETE FROM gate').run();
      console.log('\nGroup password changed.');
      console.log('Now restart the site so it takes effect:\n  sudo systemctl restart upipination\n');
      console.log('People already logged in stay logged in. Anyone new or logged out needs the new password.');
      break;
    }
    case 'users': {
      const rows = db.prepare('SELECT id, username, name, avatar, created FROM users ORDER BY id').all();
      if (!rows.length) return console.log('No accounts yet.');
      console.table(rows.map(u => ({ id: u.id, username: u.username, name: u.name, photo: u.avatar ? 'yes' : 'no', created: when(u.created) })));
      break;
    }
    case 'reset-password': {
      const u = userBy(need(arg, 'reset-password <username>'));
      if (!process.stdin.isTTY) { console.error('Run this in an interactive terminal.'); process.exit(1); }
      const a = await askHidden(`New password for ${u.username} (at least 8 characters): `);
      if (a.length < 8 || a.length > 200) { console.error('Must be 8 to 200 characters. Nothing changed.'); process.exit(1); }
      const b = await askHidden('Type it again: ');
      if (a !== b) { console.error('They do not match. Nothing changed.'); process.exit(1); }
      db.prepare('UPDATE users SET pw = ? WHERE id = ?').run(await hash(a), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      console.log(`Password changed for ${u.username}. Tell them the new one privately.`);
      break;
    }
    case 'rename': {
      const [username, ...rest] = args;
      const name = rest.join(' ').replace(/\s+/g, ' ').trim();
      need(username && name, 'rename <username> <new name>');
      if (name.length > 24) { console.error('Max 24 characters.'); process.exit(1); }
      const u = userBy(username);
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
      done(`${u.name} is now called ${name}.`);
      break;
    }
    case 'remove-avatar': {
      const u = userBy(need(arg, 'remove-avatar <username>'));
      rmFile(u.avatar);
      db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(u.id);
      done(`Removed the profile picture of ${u.username}.`);
      break;
    }
    case 'logout': {
      const u = userBy(need(arg, 'logout <username>'));
      const n = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id).changes;
      console.log(`Logged out ${u.username} (${n} session(s)).`);
      break;
    }
    case 'logout-all': {
      const n = db.prepare('DELETE FROM sessions').run().changes;
      console.log(`Logged out everyone (${n} session(s)). They keep their accounts and can log in again.`);
      break;
    }
    case 'delete-user': {
      const u = userBy(need(arg, 'delete-user <username>'));
      const tx = db.transaction(() => {
        for (const p of db.prepare('SELECT media FROM posts WHERE user_id = ?').all(u.id)) JSON.parse(p.media).forEach(rmFile);
        for (const a of db.prepare('SELECT file FROM art WHERE user_id = ?').all(u.id)) rmFile(a.file);
        for (const e of db.prepare('SELECT file FROM emojis WHERE user_id = ?').all(u.id)) rmFile(e.file);
        for (const g of db.prepare('SELECT file FROM gifs WHERE user_id = ?').all(u.id)) rmFile(g.file);
        rmFile(u.avatar);
        for (const t of ['posts', 'comments', 'chat', 'art', 'emojis', 'gifs', 'going', 'events']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
      });
      tx();
      done(`Deleted ${u.username} and everything they posted.`);
      break;
    }
    case 'posts': {
      const n = Number(arg) || 20;
      const rows = db.prepare('SELECT id, user_id, text, media, ts FROM posts ORDER BY id DESC LIMIT ?').all(n);
      if (!rows.length) return console.log('No posts.');
      console.table(rows.map(p => ({ id: p.id, by: nameOf(p.user_id), when: when(p.ts), files: JSON.parse(p.media).length, text: short(p.text) })));
      break;
    }
    case 'delete-post': {
      const id = Number(need(arg, 'delete-post <id>'));
      const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
      if (!p) { console.error('No post with that ID. Run: admin.js posts'); process.exit(1); }
      JSON.parse(p.media).forEach(rmFile);
      db.prepare('DELETE FROM posts WHERE id = ?').run(id);
      done(`Deleted post ${id} by ${nameOf(p.user_id)}.`);
      break;
    }
    case 'comments': {
      const id = Number(need(arg, 'comments <post id>'));
      const rows = db.prepare('SELECT id, user_id, text, ts FROM comments WHERE post_id = ? ORDER BY id').all(id);
      if (!rows.length) return console.log('No comments on that post.');
      console.table(rows.map(c => ({ id: c.id, by: nameOf(c.user_id), when: when(c.ts), text: short(c.text) })));
      break;
    }
    case 'delete-comment': {
      const n = db.prepare('DELETE FROM comments WHERE id = ?').run(Number(need(arg, 'delete-comment <id>'))).changes;
      n ? done('Comment deleted.') : console.error('No comment with that ID.');
      break;
    }
    case 'chat': {
      const n = Number(arg) || 30;
      const rows = db.prepare('SELECT * FROM (SELECT id, user_id, text, gif, sys, ts FROM chat ORDER BY id DESC LIMIT ?) ORDER BY id').all(n);
      if (!rows.length) return console.log('Chat is empty.');
      console.table(rows.map(m => ({ id: m.id, by: m.sys ? '(system)' : nameOf(m.user_id), when: when(m.ts), text: m.gif ? '[GIF]' : short(m.text) })));
      break;
    }
    case 'delete-message': {
      const n = db.prepare('DELETE FROM chat WHERE id = ?').run(Number(need(arg, 'delete-message <id>'))).changes;
      n ? done('Message deleted.') : console.error('No message with that ID.');
      break;
    }
    case 'clear-chat': {
      const n = db.prepare('DELETE FROM chat').run().changes;
      done(`Deleted ${n} chat message(s).`);
      break;
    }
    case 'events': {
      const rows = db.prepare('SELECT id, user_id, title, date, time, place FROM events ORDER BY date').all();
      if (!rows.length) return console.log('No events.');
      console.table(rows.map(e => ({ id: e.id, by: nameOf(e.user_id), date: e.date, time: e.time || '', title: short(e.title, 40), place: short(e.place, 30) })));
      break;
    }
    case 'delete-event': {
      const n = db.prepare('DELETE FROM events WHERE id = ?').run(Number(need(arg, 'delete-event <id>'))).changes;
      n ? done('Event deleted.') : console.error('No event with that ID.');
      break;
    }
    case 'art': {
      const rows = db.prepare('SELECT id, user_id, file, ts FROM art ORDER BY id DESC').all();
      if (!rows.length) return console.log('No art yet.');
      console.table(rows.map(a => ({ id: a.id, by: nameOf(a.user_id), when: when(a.ts), file: a.file })));
      break;
    }
    case 'delete-art': {
      const id = Number(need(arg, 'delete-art <id>'));
      const a = db.prepare('SELECT file FROM art WHERE id = ?').get(id);
      if (!a) { console.error('No art with that ID.'); process.exit(1); }
      rmFile(a.file);
      db.prepare('DELETE FROM art WHERE id = ?').run(id);
      done('Art deleted.');
      break;
    }
    case 'emojis': {
      const rows = db.prepare('SELECT name, user_id FROM emojis ORDER BY name').all();
      if (!rows.length) return console.log('No custom emojis.');
      console.table(rows.map(e => ({ name: `:${e.name}:`, by: nameOf(e.user_id) })));
      break;
    }
    case 'delete-emoji': {
      const name = need(arg, 'delete-emoji <name>').replace(/:/g, '').toLowerCase();
      const e = db.prepare('SELECT file FROM emojis WHERE name = ?').get(name);
      if (!e) { console.error('No emoji with that name.'); process.exit(1); }
      rmFile(e.file);
      db.prepare('DELETE FROM emojis WHERE name = ?').run(name);
      done(`Deleted :${name}:.`);
      break;
    }
    case 'gifs': {
      const rows = db.prepare('SELECT id, user_id, file, ts FROM gifs ORDER BY id DESC').all();
      if (!rows.length) return console.log('No GIFs.');
      console.table(rows.map(g => ({ id: g.id, by: nameOf(g.user_id), when: when(g.ts), file: g.file })));
      break;
    }
    case 'delete-gif': {
      const id = Number(need(arg, 'delete-gif <id>'));
      const g = db.prepare('SELECT file FROM gifs WHERE id = ?').get(id);
      if (!g) { console.error('No GIF with that ID.'); process.exit(1); }
      rmFile(g.file);
      db.prepare('DELETE FROM gifs WHERE id = ?').run(id);
      done('GIF deleted.');
      break;
    }
    default:
      console.log(HELP);
  }
  db.close();
})();
