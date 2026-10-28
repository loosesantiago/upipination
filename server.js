'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');
const { hash, verify } = require('./lib/pw');

// ---------- config ----------
const ROOT = __dirname;
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UP = path.join(DATA, 'uploads');
const TMP = path.join(DATA, 'tmp');
const CONFIG = path.join(DATA, 'config.json');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // only reachable from this PC (the tunnel connects locally)
const ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
const FORCE_SECURE = process.env.COOKIE_SECURE === '1';
const DAY = 864e5;
const SESSION_MS = 30 * DAY;

if (!fs.existsSync(CONFIG)) {
  console.error('\nNo group password yet. Run first:  npm run setup\n');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
if (!config.group || !config.v) { console.error('data/config.json is invalid. Run: npm run setup'); process.exit(1); }
for (const d of [UP, TMP]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true });

// ---------- database ----------
const db = new Database(path.join(DATA, 'upipination.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw TEXT NOT NULL, avatar TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gate (token TEXT PRIMARY KEY, v TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT, gif TEXT, sys INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, text TEXT, media TEXT NOT NULL DEFAULT '[]', ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT, place TEXT, note TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS going (event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (event_id, user_id));
CREATE TABLE IF NOT EXISTS art (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, file TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS emojis (name TEXT PRIMARY KEY, file TEXT NOT NULL, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gifs (id INTEGER PRIMARY KEY, file TEXT NOT NULL, user_id INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS notifs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE, chat_id INTEGER REFERENCES chat(id) ON DELETE CASCADE, ts INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS notifs_user ON notifs(user_id, id);
CREATE TABLE IF NOT EXISTS yeahs (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ts INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
`);
// name color chosen by the user (1-12, matching --n1..--n12 in style.css); NULL = automatic
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'color')) db.exec('ALTER TABLE users ADD COLUMN color INTEGER');
const COLORS = 12;
const POSTS_PER_PAGE = 10;
const ART_PER_PAGE = 24;

const q = {
  userBySession: db.prepare('SELECT u.id, u.username, u.name, u.avatar, u.color, s.token AS sid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?'),
  sessionAlive: db.prepare('SELECT 1 FROM sessions WHERE token = ? AND expires > ?'),
  userById: db.prepare('SELECT id, name, avatar, color FROM users WHERE id = ?'),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  users: db.prepare('SELECT id, name, avatar, color FROM users'),
  addUser: db.prepare('INSERT INTO users (username, name, pw, created) VALUES (?, ?, ?, ?)'),
  setName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
  setColor: db.prepare('UPDATE users SET color = ? WHERE id = ?'),
  addSession: db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  gateGet: db.prepare('SELECT 1 FROM gate WHERE token = ? AND v = ? AND expires > ?'),
  gateAdd: db.prepare('INSERT INTO gate (token, v, expires) VALUES (?, ?, ?)'),
  purge: db.prepare('DELETE FROM sessions WHERE expires < ?'),
  purgeGate: db.prepare('DELETE FROM gate WHERE expires < ? OR v <> ?'),
  addChat: db.prepare('INSERT INTO chat (user_id, text, gif, sys, ts) VALUES (?, ?, ?, ?, ?)'),
  chatById: db.prepare('SELECT id, user_id AS uid, text, gif, sys, ts FROM chat WHERE id = ?'),
  recentChat: db.prepare('SELECT * FROM (SELECT id, user_id AS uid, text, gif, sys, ts FROM chat ORDER BY id DESC LIMIT 300) ORDER BY id'),
  myMessages: db.prepare('SELECT COUNT(*) AS n FROM chat WHERE user_id = ? AND sys = 0'),
  postsPage: db.prepare('SELECT id, user_id AS uid, text, media, ts FROM posts ORDER BY id DESC LIMIT ? OFFSET ?'),
  postCount: db.prepare('SELECT COUNT(*) AS n FROM posts'),
  postsNewer: db.prepare('SELECT COUNT(*) AS n FROM posts WHERE id > ?'),
  postCounts: db.prepare('SELECT user_id AS uid, COUNT(*) AS n FROM posts GROUP BY user_id'),
  recentPosts: db.prepare('SELECT id, user_id AS uid, substr(text, 1, 200) AS text, ts FROM posts ORDER BY id DESC LIMIT 3'),
  // ? is a JSON array of post ids
  comments: db.prepare('SELECT id, post_id, user_id AS uid, text, ts FROM comments WHERE post_id IN (SELECT value FROM json_each(?)) ORDER BY id'),
  postExists: db.prepare('SELECT 1 FROM posts WHERE id = ?'),
  yeahs: db.prepare('SELECT post_id, user_id FROM yeahs WHERE post_id IN (SELECT value FROM json_each(?)) ORDER BY ts'),
  addYeah: db.prepare('INSERT OR IGNORE INTO yeahs (post_id, user_id, ts) VALUES (?, ?, ?)'),
  delYeah: db.prepare('DELETE FROM yeahs WHERE post_id = ? AND user_id = ?'),
  yeahNotified: db.prepare("SELECT 1 FROM notifs WHERE kind = 'yeah' AND post_id = ? AND actor_id = ?"),
  addPost: db.prepare('INSERT INTO posts (user_id, text, media, ts) VALUES (?, ?, ?, ?)'),
  addComment: db.prepare('INSERT INTO comments (post_id, user_id, text, ts) VALUES (?, ?, ?, ?)'),
  events: db.prepare('SELECT id, user_id AS uid, title, date, time, place, note FROM events WHERE date >= ? ORDER BY date, time'),
  going: db.prepare('SELECT event_id, user_id FROM going'),
  eventExists: db.prepare('SELECT 1 FROM events WHERE id = ?'),
  addEvent: db.prepare('INSERT INTO events (user_id, title, date, time, place, note, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  addGoing: db.prepare('INSERT OR IGNORE INTO going (event_id, user_id) VALUES (?, ?)'),
  delGoing: db.prepare('DELETE FROM going WHERE event_id = ? AND user_id = ?'),
  artPage: db.prepare('SELECT id, user_id AS uid, file, ts FROM art ORDER BY id DESC LIMIT ? OFFSET ?'),
  artCount: db.prepare('SELECT COUNT(*) AS n FROM art'),
  artCounts: db.prepare('SELECT user_id AS uid, COUNT(*) AS n FROM art GROUP BY user_id'),
  recentArt: db.prepare('SELECT id, user_id AS uid, file, ts FROM art ORDER BY id DESC LIMIT 6'),
  addArt: db.prepare('INSERT INTO art (user_id, file, ts) VALUES (?, ?, ?)'),
  emojis: db.prepare('SELECT name, file, user_id AS uid FROM emojis ORDER BY name'),
  emojiGet: db.prepare('SELECT * FROM emojis WHERE name = ?'),
  emojiPut: db.prepare('INSERT OR REPLACE INTO emojis (name, file, user_id) VALUES (?, ?, ?)'),
  gifs: db.prepare('SELECT id, file FROM gifs ORDER BY id DESC LIMIT 300'),
  gifById: db.prepare('SELECT file FROM gifs WHERE id = ?'),
  addGif: db.prepare('INSERT INTO gifs (file, user_id, ts) VALUES (?, ?, ?)'),
  postAuthor: db.prepare('SELECT user_id FROM posts WHERE id = ?'),
  addNotif: db.prepare('INSERT INTO notifs (user_id, actor_id, kind, post_id, comment_id, chat_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  notifs: db.prepare(`SELECT n.id, n.actor_id AS actor, n.kind, n.post_id AS post, n.chat_id AS chat, n.ts, n.seen,
    substr(COALESCE(c.text, ch.text, p.text, ''), 1, 200) AS text
    FROM notifs n LEFT JOIN comments c ON c.id = n.comment_id LEFT JOIN chat ch ON ch.id = n.chat_id LEFT JOIN posts p ON p.id = n.post_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`),
  seenNotifs: db.prepare('UPDATE notifs SET seen = 1 WHERE user_id = ? AND seen = 0'),
  purgeNotifs: db.prepare('DELETE FROM notifs WHERE ts < ?')
};

// ---------- helpers ----------
const now = () => Date.now();
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const toId = v => (/^\d{1,12}$/.test(String(v)) ? Number(v) : 0);
const A = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pub = u => ({ id: u.id, name: u.name, avatar: u.avatar || null, color: u.color || null });
const countsBy = rows => Object.fromEntries(rows.map(r => [r.uid, r.n]));
// clamps the requested page to 1..pages
function pageOf(total, per, page) {
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, toId(page) || 1), pages);
  return { page: p, pages, total, offset: (p - 1) * per };
}
const FILE_RE = /^[a-f0-9]{32}\.(jpg|png|gif|webp|mp4|webm|mov)$/;

// @mentions use display names (which may contain spaces). Longest names are matched first,
// so "@Ana María" tags Ana María and not also Ana.
const WORD = /[\p{L}\p{N}_]/u;
function mentionedIds(text, actorId) {
  if (!text || !text.includes('@')) return [];
  let low = text.toLowerCase();
  const ids = [];
  const users = q.users.all().sort((a, b) => b.name.length - a.name.length);
  for (const u of users) {
    const tag = '@' + u.name.toLowerCase();
    for (let i = low.indexOf(tag); i !== -1; i = low.indexOf(tag, i + 1)) {
      if ((i > 0 && WORD.test(low.charAt(i - 1))) || WORD.test(low.charAt(i + tag.length))) continue;
      low = low.slice(0, i) + ' '.repeat(tag.length) + low.slice(i + tag.length);
      if (!ids.includes(u.id)) ids.push(u.id);
    }
  }
  return ids.filter(id => id !== actorId);
}

// strips control and bidi-override characters, trims, checks length
function clean(v, max, min = 0) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return s.length >= min && s.length <= max ? s : null;
}
function oneLine(v, max, min = 0) {
  const s = clean(v, 1000, 0);
  if (s === null) return null;
  const t = s.replace(/\s+/g, ' ');
  return t.length >= min && t.length <= max ? t : null;
}
function cookiesFrom(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const v = part.slice(i + 1).trim();
    if (/^[A-Za-z0-9_-]{20,100}$/.test(v)) out[part.slice(0, i).trim()] = v;
  }
  return out;
}
function setCookie(req, res, name, value, maxAgeMs) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (FORCE_SECURE || req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
function userFromHeader(header) {
  const sid = cookiesFrom(header).sid;
  return sid ? q.userBySession.get(sha(sid), now()) || null : null;
}
function gateFromHeader(header) {
  const g = cookiesFrom(header).gate;
  return !!(g && q.gateGet.get(sha(g), config.v, now()));
}
function startSession(req, res, userId) {
  const t = newToken();
  q.addSession.run(sha(t), userId, now() + SESSION_MS);
  setCookie(req, res, 'sid', t, SESSION_MS);
}

// brute-force protection: lock a key for 15 minutes after too many failures
const fails = new Map();
const isLocked = k => (fails.get(k)?.until || 0) > now();
function noteFail(k, max) {
  const f = fails.get(k) || { n: 0, until: 0, last: 0 };
  f.n += 1; f.last = now();
  if (f.n >= max) { f.n = 0; f.until = now() + 15 * 60e3; }
  fails.set(k, f);
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const originOk = o => !o || !ORIGIN || o === ORIGIN || LOCAL_ORIGIN.test(o);

// ---------- uploads ----------
const upload = multer({ dest: TMP, limits: { fileSize: 60 * 1024 * 1024, files: 10, fields: 5, fieldSize: 8 * 1024, parts: 16 } });
const files = (field, max) => (req, res, next) =>
  upload.array(field, max)(req, res, err => (err ? res.status(400).json({ error: 'file' }) : next()));
const drop = list => (list || []).forEach(f => fs.rmSync(f.path, { force: true }));

const IMG = ['jpg', 'png', 'gif', 'webp'];
const MEDIA = [...IMG, 'mp4', 'webm', 'mov'];
const MAX = { jpg: 12e6, png: 12e6, gif: 12e6, webp: 12e6, mp4: 60e6, webm: 60e6, mov: 60e6 };

// identify the real file type from its first bytes (never trust the name or browser-sent type)
function sniff(p) {
  const fd = fs.openSync(p, 'r');
  const b = Buffer.alloc(16);
  fs.readSync(fd, b, 0, 16, 0);
  fs.closeSync(fd);
  const ascii = (s, e) => b.subarray(s, e).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^(hei|hev|mif|msf|avi)/.test(brand)) return null; // HEIC/AVIF photos: not supported by all browsers
    return brand === 'qt  ' ? 'mov' : 'mp4';
  }
  return null; // SVG, HTML, executables, etc. are always rejected
}
function keep(list, allowed, cap = Infinity) {
  const saved = [];
  try {
    for (const f of list) {
      const ext = sniff(f.path);
      if (!ext || !allowed.includes(ext) || f.size > Math.min(MAX[ext], cap)) throw Object.assign(new Error('file'), { status: 400 });
      const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
      fs.renameSync(f.path, path.join(UP, name));
      saved.push(name);
    }
    return saved;
  } catch (e) {
    drop(list);
    saved.forEach(n => fs.rmSync(path.join(UP, n), { force: true }));
    throw e;
  }
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", ...(ORIGIN ? [ORIGIN.replace(/^http/, 'ws')] : [])],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' }
}));
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // tell search engines never to index or show anything from this site (covers images/files too)
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive, noimageindex');
  next();
});

const limit = (minutes, max) => rateLimit({
  windowMs: minutes * 60e3, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate' })
});
app.use('/api', limit(1, 240));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // CSRF protection: custom header (forces same-origin) + origin check
  if (req.method !== 'GET' && (req.get('X-Upi') !== '1' || !originOk(req.get('origin')))) return res.status(403).json({ error: 'csrf' });
  next();
});
app.use('/api', express.json({ limit: '16kb' }));

function requireUser(req, res, next) {
  const u = userFromHeader(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'auth' });
  req.user = u;
  next();
}

// --- auth ---
const authLimit = limit(15, 30);
let DUMMY = '';

app.get('/api/status', (req, res) => {
  const u = userFromHeader(req.headers.cookie);
  res.json({ gate: !!u || gateFromHeader(req.headers.cookie), user: u ? pub(u) : null });
});

app.post('/api/gate', authLimit, A(async (req, res) => {
  const key = 'g:' + req.ip;
  if (isLocked(key)) return res.status(429).json({ error: 'locked' });
  const pw = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  if (!pw || !(await verify(pw, config.group))) {
    noteFail(key, 5);
    console.warn(`[security] wrong group password from ${req.ip}`);
    return res.status(400).json({ error: 'bad' });
  }
  fails.delete(key);
  const t = newToken();
  q.gateAdd.run(sha(t), config.v, now() + SESSION_MS);
  setCookie(req, res, 'gate', t, SESSION_MS);
  res.json({ ok: true });
}));

app.post('/api/signup', authLimit, A(async (req, res) => {
  if (!gateFromHeader(req.headers.cookie)) return res.status(403).json({ error: 'gate' });
  const b = req.body || {};
  const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) return res.status(400).json({ error: 'username' });
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) return res.status(400).json({ error: 'password' });
  const name = oneLine(b.name, 24, 1);
  if (!name) return res.status(400).json({ error: 'name' });
  if (q.userByUsername.get(username)) return res.status(409).json({ error: 'taken' });
  const pw = await hash(b.password);
  let id;
  try { id = Number(q.addUser.run(username, name, pw, now()).lastInsertRowid); } catch { return res.status(409).json({ error: 'taken' }); }
  startSession(req, res, id);
  sys(`${name} se unió al grupo`);
  changed();
  res.json({ user: pub(q.userById.get(id)) });
}));

app.post('/api/login', authLimit, A(async (req, res) => {
  if (!gateFromHeader(req.headers.cookie)) return res.status(403).json({ error: 'gate' });
  const b = req.body || {};
  const username = typeof b.username === 'string' ? b.username.trim().toLowerCase().slice(0, 40) : '';
  const password = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
  const kU = 'u:' + username, kI = 'i:' + req.ip;
  if (isLocked(kU) || isLocked(kI)) return res.status(429).json({ error: 'locked' });
  const u = q.userByUsername.get(username);
  const ok = await verify(password, u ? u.pw : DUMMY); // same timing whether or not the user exists
  if (!u || !ok) {
    noteFail(kU, 5); noteFail(kI, 15);
    console.warn(`[security] failed login for "${username}" from ${req.ip}`);
    return res.status(400).json({ error: 'bad' });
  }
  fails.delete(kU);
  startSession(req, res, u.id);
  res.json({ user: pub(u) });
}));

app.post('/api/logout', (req, res) => {
  const sid = cookiesFrom(req.headers.cookie).sid;
  if (sid) { const h = sha(sid); q.delSession.run(h); kickSession(h); }
  setCookie(req, res, 'sid', '', 0);
  res.json({ ok: true });
});

// --- data ---
// posts and art come in pages; the state only carries totals and the few newest for the sidebar
app.get('/api/state', requireUser, (req, res) => {
  const goingBy = {};
  for (const g of q.going.all()) (goingBy[g.event_id] ||= []).push(g.user_id);
  const since = new Date(now() - 2 * DAY).toISOString().slice(0, 10);
  res.json({
    me: pub(req.user),
    users: q.users.all(),
    online: [...online.keys()],
    chat: q.recentChat.all().map(c => ({ ...c, sys: !!c.sys })),
    recentPosts: q.recentPosts.all(),
    recentArt: q.recentArt.all(),
    counts: { posts: countsBy(q.postCounts.all()), art: countsBy(q.artCounts.all()) },
    totals: { posts: q.postCount.get().n, art: q.artCount.get().n },
    events: q.events.all(since).map(e => ({ ...e, going: goingBy[e.id] || [] })),
    emojis: q.emojis.all(),
    gifs: q.gifs.all(),
    notifs: q.notifs.all(req.user.id).map(n => ({ ...n, seen: !!n.seen })),
    stats: { messages: q.myMessages.get(req.user.id).n }
  });
});

// ?page=N, or ?post=ID to get whichever page holds that post (used by notifications)
app.get('/api/posts', requireUser, (req, res) => {
  const total = q.postCount.get().n;
  let want = req.query.page;
  const postId = toId(req.query.post);
  if (postId) want = Math.floor(q.postsNewer.get(postId).n / POSTS_PER_PAGE) + 1;
  const pg = pageOf(total, POSTS_PER_PAGE, want);
  const rows = q.postsPage.all(POSTS_PER_PAGE, pg.offset);
  const ids = JSON.stringify(rows.map(p => p.id));
  const byPost = {};
  for (const c of q.comments.all(ids)) (byPost[c.post_id] ||= []).push({ id: c.id, uid: c.uid, text: c.text, ts: c.ts });
  const yeahsBy = {};
  for (const y of q.yeahs.all(ids)) (yeahsBy[y.post_id] ||= []).push(y.user_id);
  res.json({
    page: pg.page, pages: pg.pages, total,
    items: rows.map(p => ({ ...p, media: JSON.parse(p.media), comments: byPost[p.id] || [], yeahs: yeahsBy[p.id] || [] }))
  });
});

app.get('/api/art', requireUser, (req, res) => {
  const total = q.artCount.get().n;
  const pg = pageOf(total, ART_PER_PAGE, req.query.page);
  res.json({ page: pg.page, pages: pg.pages, total, items: q.artPage.all(ART_PER_PAGE, pg.offset) });
});

app.post('/api/color', requireUser, (req, res) => {
  const c = req.body?.color;
  if (!(c === null || (Number.isInteger(c) && c >= 1 && c <= COLORS))) return res.status(400).json({ error: 'bad_request' });
  q.setColor.run(c, req.user.id);
  changed();
  res.json({ ok: true });
});

app.post('/api/nickname', requireUser, (req, res) => {
  const name = oneLine(req.body?.name, 24, 1);
  if (!name) return res.status(400).json({ error: 'name' });
  if (name !== req.user.name) {
    q.setName.run(name, req.user.id);
    sys(`${req.user.name} ahora se llama ${name}`);
    changed();
  }
  res.json({ ok: true });
});

app.post('/api/avatar', requireUser, files('file', 1), (req, res) => {
  const list = req.files || [];
  if (list.length !== 1) { drop(list); return res.status(400).json({ error: 'file' }); }
  const [file] = keep(list, IMG, 3e6);
  const old = q.userById.get(req.user.id).avatar;
  q.setAvatar.run(file, req.user.id);
  if (old && FILE_RE.test(old)) fs.rmSync(path.join(UP, old), { force: true });
  changed();
  res.json({ ok: true });
});

app.post('/api/posts', requireUser, files('files', 6), (req, res) => {
  const list = req.files || [];
  const text = clean(req.body?.text ?? '', 2000);
  if (text === null || (!text && !list.length)) { drop(list); return res.status(400).json({ error: 'empty' }); }
  const media = keep(list, MEDIA);
  const t = now();
  const postId = Number(q.addPost.run(req.user.id, text, JSON.stringify(media), t).lastInsertRowid);
  notify(mentionedIds(text, req.user.id), req.user.id, 'post', { post: postId }, t);
  changed();
  res.json({ ok: true });
});

app.post('/api/posts/:id/comments', requireUser, (req, res) => {
  const id = toId(req.params.id);
  const text = clean(req.body?.text, 1000, 1);
  if (!id || !text || !q.postExists.get(id)) return res.status(400).json({ error: 'bad_request' });
  const t = now();
  const commentId = Number(q.addComment.run(id, req.user.id, text, t).lastInsertRowid);
  const tagged = mentionedIds(text, req.user.id);
  notify(tagged, req.user.id, 'comment_mention', { post: id, comment: commentId }, t);
  const author = q.postAuthor.get(id).user_id;
  if (author !== req.user.id && !tagged.includes(author)) notify([author], req.user.id, 'comment', { post: id, comment: commentId }, t);
  changed();
  res.json({ ok: true });
});

// "Yeah..." reaction: press again to take it back
app.post('/api/posts/:id/yeah', requireUser, (req, res) => {
  const id = toId(req.params.id);
  if (!id || !q.postExists.get(id)) return res.status(400).json({ error: 'bad_request' });
  if (q.delYeah.run(id, req.user.id).changes === 0) {
    q.addYeah.run(id, req.user.id, now());
    // notify the author once per person, so toggling on and off doesn't spam them
    const author = q.postAuthor.get(id).user_id;
    if (author !== req.user.id && !q.yeahNotified.get(id, req.user.id)) notify([author], req.user.id, 'yeah', { post: id }, now());
  }
  changed();
  res.json({ ok: true });
});

app.post('/api/notifs/seen', requireUser, (req, res) => {
  if (q.seenNotifs.run(req.user.id).changes) io.to('u' + req.user.id).emit('notif');
  res.json({ ok: true });
});

app.post('/api/events', requireUser, (req, res) => {
  const b = req.body || {};
  const title = oneLine(b.title, 80, 1);
  const place = oneLine(b.place ?? '', 80);
  const note = clean(b.note ?? '', 1000);
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && !isNaN(Date.parse(b.date)) ? b.date : null;
  const time = typeof b.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : '';
  if (!title || !date || place === null || note === null) return res.status(400).json({ error: 'bad_request' });
  const id = Number(q.addEvent.run(req.user.id, title, date, time, place, note, now()).lastInsertRowid);
  q.addGoing.run(id, req.user.id);
  sys(`${req.user.name} creó un evento: ${title}`);
  changed();
  res.json({ ok: true });
});

app.post('/api/events/:id/going', requireUser, (req, res) => {
  const id = toId(req.params.id);
  if (!id || !q.eventExists.get(id)) return res.status(400).json({ error: 'bad_request' });
  if (q.delGoing.run(id, req.user.id).changes === 0) q.addGoing.run(id, req.user.id);
  changed();
  res.json({ ok: true });
});

app.post('/api/art', requireUser, files('files', 10), (req, res) => {
  const list = req.files || [];
  if (!list.length) return res.status(400).json({ error: 'file' });
  const t = now();
  for (const f of keep(list, IMG)) q.addArt.run(req.user.id, f, t);
  changed();
  res.json({ ok: true });
});

app.post('/api/emojis', requireUser, files('file', 1), (req, res) => {
  const list = req.files || [];
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().toLowerCase() : '';
  if (list.length !== 1 || !/^[a-z0-9_]{2,24}$/.test(name)) { drop(list); return res.status(400).json({ error: 'bad_request' }); }
  const existing = q.emojiGet.get(name);
  if (existing && existing.user_id !== req.user.id) { drop(list); return res.status(409).json({ error: 'emoji_taken' }); }
  const [file] = keep(list, IMG, 1.5e6);
  q.emojiPut.run(name, file, req.user.id);
  if (existing && FILE_RE.test(existing.file)) fs.rmSync(path.join(UP, existing.file), { force: true });
  sys(`${req.user.name} creó el emoji :${name}:`);
  changed();
  res.json({ ok: true });
});

app.post('/api/gifs', requireUser, files('files', 6), (req, res) => {
  const list = req.files || [];
  if (!list.length) return res.status(400).json({ error: 'file' });
  const t = now();
  for (const f of keep(list, ['gif', 'webp'])) q.addGif.run(f, req.user.id, t);
  changed();
  res.json({ ok: true });
});

// uploaded files: members only, strict names, no sniffing
app.get('/uploads/:file', requireUser, (req, res) => {
  const f = req.params.file;
  if (!FILE_RE.test(f)) return res.sendStatus(404);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(UP, f), err => { if (err && !res.headersSent) res.sendStatus(404); });
});

// header photos: members only
app.use('/img', requireUser, express.static(path.join(ROOT, 'assets'), { maxAge: '7d', index: false, dotfiles: 'deny' }));
// the page itself (no private data inside). "no-cache" makes browsers and Cloudflare check for
// a newer version on every load (a quick 304 when unchanged), so deploys show up right away.
app.use(express.static(path.join(ROOT, 'public'), { dotfiles: 'deny', setHeaders: res => res.set('Cache-Control', 'no-cache') }));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  if (err.status === 400 || err.status === 413 || err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: err.message === 'file' ? 'file' : 'bad_request' });
  }
  console.error(err);
  res.status(500).json({ error: 'server' });
});

// ---------- realtime chat ----------
const server = http.createServer(app);
server.headersTimeout = 30e3;
server.requestTimeout = 5 * 60e3;
const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024,
  allowRequest: (req, cb) => cb(null, originOk(req.headers.origin))
});
io.use((socket, next) => {
  const u = userFromHeader(socket.handshake.headers.cookie);
  if (!u) return next(new Error('auth'));
  socket.data.uid = u.id;
  socket.data.sid = u.sid;
  next();
});

const online = new Map();
const presence = () => io.emit('presence', [...online.keys()]);
const changed = () => io.emit('changed');
function emitChat(id) {
  const row = q.chatById.get(id);
  if (row) io.emit('chat', { ...row, sys: !!row.sys });
}
function sys(text) { emitChat(Number(q.addChat.run(null, text, null, 1, now()).lastInsertRowid)); }
function notify(ids, actorId, kind, ref, ts) {
  for (const id of ids) {
    q.addNotif.run(id, actorId, kind, ref.post || null, ref.comment || null, ref.chat || null, ts);
    io.to('u' + id).emit('notif');
  }
}
function kickSession(h) {
  for (const s of io.of('/').sockets.values()) if (s.data.sid === h) { s.emit('logout'); s.disconnect(true); }
}

io.on('connection', socket => {
  const uid = socket.data.uid;
  socket.join('u' + uid);
  online.set(uid, (online.get(uid) || 0) + 1);
  presence();
  let windowStart = now(), count = 0, lastTyping = 0;

  socket.on('chat', (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!q.sessionAlive.get(socket.data.sid, now())) { socket.emit('logout'); socket.disconnect(true); return; }
    const t = now();
    if (t - windowStart > 10e3) { windowStart = t; count = 0; }
    if (++count > 8) return reply({ error: 'rate' });
    if (!msg || typeof msg !== 'object') return reply({ error: 'bad' });
    let text = null, gif = null;
    if (msg.gif != null) {
      const g = q.gifById.get(toId(msg.gif));
      if (!g) return reply({ error: 'bad' });
      gif = g.file;
    } else {
      text = clean(msg.text, 1000, 1);
      if (!text) return reply({ error: 'bad' });
    }
    const chatId = Number(q.addChat.run(uid, text, gif, 0, t).lastInsertRowid);
    emitChat(chatId);
    if (text) notify(mentionedIds(text, uid), uid, 'chat', { chat: chatId }, t);
    reply({ ok: true });
  });

  socket.on('typing', () => {
    const t = now();
    if (t - lastTyping < 1500) return;
    lastTyping = t;
    socket.broadcast.emit('typing', uid);
  });

  socket.on('disconnect', () => {
    const n = (online.get(uid) || 1) - 1;
    if (n > 0) online.set(uid, n); else online.delete(uid);
    presence();
  });
});

// ---------- housekeeping ----------
setInterval(() => {
  const t = now();
  q.purge.run(t);
  q.purgeGate.run(t, config.v);
  q.purgeNotifs.run(t - 60 * DAY);
  for (const [k, f] of fails) if (f.until < t && t - f.last > 60 * 60e3) fails.delete(k);
}, 30 * 60e3).unref();

function shutdown() { io.close(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

hash(crypto.randomBytes(16).toString('hex')).then(d => {
  DUMMY = d;
  server.listen(PORT, HOST, () => {
    console.log(`Upipination running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (!ORIGIN) console.log('Tip: once your domain works, set PUBLIC_ORIGIN in .env (see README).');
  });
});
