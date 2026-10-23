const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const mail = require('./mail');
const { fetchRoutine } = require('./sheets');
const { parseNote } = require('../src/parse');

const PROD = process.env.NODE_ENV === 'production';
const PORT = +process.env.PORT || 8787;
const BASE = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Free test-mode purchases are a development convenience only; in production without Stripe the store is closed.
const STORE = STRIPE_KEY ? 'live' : PROD ? 'closed' : 'test';
const ROOT = path.join(__dirname, '..');
const DOWNLOADS = path.join(__dirname, 'downloads');
const COOKIE = 'peeky_session';
const DAY = 864e5;
const SESSION_IDLE = 180 * DAY;

const now = () => Date.now();
const uid = () => crypto.randomBytes(9).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const catalog = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- auth helpers ----------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 64));
}
// Only a hash of each session token is stored, so a database leak doesn't leak live sessions.
function createSession(userId, kind, label = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token, user_id, kind, label, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(sha256(token), userId, kind, label, now(), now());
  return token;
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: BASE.startsWith('https'), maxAge: SESSION_IDLE, path: '/' });
}
function tokenFrom(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const c = (req.headers.cookie || '').split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : null;
}
function loadUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(sha256(token));
  if (!s || now() - s.last_seen > SESSION_IDLE) return null;
  if (now() - s.last_seen > 6e4) db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(now(), s.token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (user) req.session = s;
  return user;
}
const auth = (req, res, next) => {
  req.user = loadUser(req);
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
};
const optionalAuth = (req, _res, next) => { req.user = loadUser(req); next(); };

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, created: u.created });
const settingsOf = (u) => ({ buddy: 'robot', voice: true, chime: true, ...JSON.parse(u.settings || '{}') });
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// Free buddies + purchases; the bundle unlocks everything.
function ownedItems(userId) {
  const cat = catalog();
  const bought = new Set(userId ? db.prepare('SELECT item FROM purchases WHERE user_id = ?').all(userId).map((r) => r.item) : []);
  return cat.items.filter((i) => i.price === 0 || bought.has(i.id) || bought.has(cat.bundle.id)).map((i) => i.id);
}
function grant(userId, item, ref) {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return;
  db.prepare('INSERT OR IGNORE INTO purchases (user_id, item, ref, created) VALUES (?, ?, ?, ?)').run(userId, item, ref, now());
}

// In-memory fixed-window rate limiting (one server instance; swap for Redis if you scale out).
const buckets = new Map();
function limited(key, max, windowMs) {
  const b = buckets.get(key);
  if (!b || now() - b.at > windowMs) { buckets.set(key, { n: 1, at: now() }); return false; }
  return ++b.n > max;
}
const rateLimit = (name, max, windowMs) => (req, res, next) =>
  limited(`${name}|${req.ip}`, max, windowMs) ? res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' }) : next();

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': CSP,
  });
  if (BASE.startsWith('https')) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Stripe needs the raw body to verify its signature, so this route comes before the JSON parser.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) return res.status(503).end();
  const sig = String(req.headers['stripe-signature'] || '');
  const t = (sig.match(/t=(\d+)/) || [])[1];
  const sigs = [...sig.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]);
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${req.body}`).digest('hex');
  const ok = t && Math.abs(now() / 1000 - +t) < 300 && sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return res.status(400).send('Bad signature');
  const event = JSON.parse(req.body);
  const s = event.data?.object;
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && s?.payment_status === 'paid' && s.client_reference_id && s.metadata?.item) {
    grant(s.client_reference_id, s.metadata.item, s.id);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));

// Cookie-authenticated writes must come from our own pages (CSRF). The desktop app sends no Origin and uses a Bearer token.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== ORIGIN && !(req.headers.authorization || '').startsWith('Bearer ')) return res.status(403).json({ error: 'Cross-site request blocked.' });
  next();
});

app.get('/healthz', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

const staticOpts = { maxAge: PROD ? '1h' : 0 };
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three'), { maxAge: PROD ? '7d' : 0 }));
app.get('/shared/buddies.js', (_req, res) => res.sendFile(path.join(ROOT, 'src', 'buddies.js'), staticOpts));
app.use('/models', express.static(path.join(__dirname, 'models'), { ...staticOpts, setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') }));
app.use('/assets', express.static(path.join(ROOT, 'web'), staticOpts));
const page = (file) => (_req, res) => res.sendFile(path.join(ROOT, 'web', file));
app.get('/', page('index.html'));
app.get(['/signin', '/signup'], page('auth.html'));
app.get(['/forgot', '/reset'], page('reset.html'));
app.get('/app', page('app.html'));
app.get('/link', page('link.html'));
// Legal pages are filled in from COMPANY_NAME / SUPPORT_EMAIL.
const legal = (file) => (_req, res) => {
  const vars = { COMPANY: process.env.COMPANY_NAME || 'Peeky', EMAIL: process.env.SUPPORT_EMAIL || 'support@example.com', UPDATED: process.env.LEGAL_UPDATED || 'October 23, 2026' };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  res.type('html').send(fs.readFileSync(path.join(ROOT, 'web', file), 'utf8').replace(/\{\{(\w+)\}\}/g, (_m, k) => esc(vars[k] ?? '')));
};
app.get('/privacy', legal('privacy.html'));
app.get('/terms', legal('terms.html'));
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /app\nDisallow: /api/\nSitemap: ${BASE}/sitemap.xml\n`));
app.get('/sitemap.xml', (_req, res) => res.type('application/xml').send(
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/signup', '/privacy', '/terms'].map((p) => `<url><loc>${BASE}${p}</loc></url>`).join('')}</urlset>`));

// Desktop installer: put the built Peeky-Setup-*.exe in server/downloads/.
const installer = () => {
  try { return fs.readdirSync(DOWNLOADS).filter((f) => /\.exe$/i.test(f)).sort().pop() || null; } catch { return null; }
};
// Or host it elsewhere (e.g. GitHub Releases) and set WINDOWS_DOWNLOAD_URL.
const EXTERNAL_DOWNLOAD = process.env.WINDOWS_DOWNLOAD_URL || '';
app.get('/api/download', (_req, res) => res.json({ windows: EXTERNAL_DOWNLOAD || installer() ? `${BASE}/download/windows` : null }));
app.get('/download/windows', (_req, res) => {
  if (EXTERNAL_DOWNLOAD) return res.redirect(EXTERNAL_DOWNLOAD);
  const f = installer();
  if (!f) return res.redirect('/#download');
  res.download(path.join(DOWNLOADS, f), f);
});

// --- accounts

app.post('/api/auth/signup', rateLimit('signup', 10, 60 * 6e4), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim().slice(0, 60);
  const password = String(req.body.password || '');
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Use at least 8 characters for your password.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
  const id = uid();
  db.prepare('INSERT INTO users (id, email, name, pass, created) VALUES (?, ?, ?, ?, ?)').run(id, email, name, hashPassword(password), now());
  setCookie(res, createSession(id, 'web'));
  mail.sendMail({
    to: email,
    subject: 'Welcome to Peeky',
    text: `Hi ${name},\n\nWelcome to Peeky! Install the app on your laptop: ${BASE}/app#devices\n\n— Peeky`,
    html: mail.layout(`<p>Hi ${name.replace(/[<>&]/g, '')},</p><p>Welcome to Peeky! Install the app on your laptop and your buddy will start reminding you.</p><p>${mail.button(`${BASE}/app#devices`, 'Get Peeky for your laptop')}</p>`),
  }).catch((e) => console.error(e.message));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

app.post('/api/auth/signin', rateLimit('signin-ip', 30, 15 * 6e4), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (limited(`signin-acct|${email}`, 10, 15 * 6e4)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !checkPassword(String(req.body.password || ''), user.pass)) return res.status(401).json({ error: 'Incorrect email or password.' });
  setCookie(res, createSession(user.id, 'web'));
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/signout', (req, res) => {
  const token = tokenFrom(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Always answers the same way so it can't be used to find out who has an account.
app.post('/api/auth/forgot', rateLimit('forgot', 5, 60 * 6e4), wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = validEmail(email) && db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO password_resets (token_hash, user_id, created) VALUES (?, ?, ?)').run(sha256(token), user.id, now());
    const link = `${BASE}/reset?token=${token}`;
    await mail.sendMail({
      to: user.email,
      subject: 'Reset your Peeky password',
      text: `Reset your Peeky password: ${link}\n\nThis link works for 1 hour.`,
      html: mail.layout(`<p>Someone asked to reset the password for your Peeky account.</p><p>${mail.button(link, 'Reset password')}</p><p style="color:#86868b;font-size:14px">This link works for 1 hour.</p>`),
    }).catch((e) => console.error(e.message));
  }
  res.json({ ok: true });
}));

app.post('/api/auth/reset', rateLimit('reset', 10, 60 * 6e4), (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Use at least 8 characters for your password.' });
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(req.body.token || '')));
  if (!row || now() - row.created > 36e5) return res.status(400).json({ error: 'This reset link has expired. Request a new one.' });
  db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id); // sign out everywhere
  setCookie(res, createSession(row.user_id, 'web'));
  res.json({ ok: true });
});

// Like /api/me but never 401s — for public pages that just want to know who's signed in.
app.get('/api/session', optionalAuth, (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

app.get('/api/me', auth, (req, res) => {
  const sheet = db.prepare('SELECT url, synced, error, items FROM sheets WHERE user_id = ?').get(req.user.id);
  res.json({
    user: publicUser(req.user),
    settings: settingsOf(req.user),
    owned: ownedItems(req.user.id),
    sheet: sheet ? { url: sheet.url, synced: sheet.synced, error: sheet.error, count: JSON.parse(sheet.items).length } : null,
  });
});

app.patch('/api/me', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// Permanently deletes the account and everything in it (notes, sessions, sheet, purchases).
app.delete('/api/me', auth, (req, res) => {
  if (!checkPassword(String(req.body.password || ''), req.user.pass)) return res.status(401).json({ error: 'That password is incorrect.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.patch('/api/settings', auth, (req, res) => {
  const next = settingsOf(req.user);
  if (typeof req.body.voice === 'boolean') next.voice = req.body.voice;
  if (typeof req.body.chime === 'boolean') next.chime = req.body.chime;
  if (req.body.buddy) {
    if (!ownedItems(req.user.id).includes(req.body.buddy)) return res.status(403).json({ error: 'Get this buddy first.' });
    next.buddy = req.body.buddy;
  }
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(next), req.user.id);
  res.json({ settings: next });
});

// --- notes (last write wins per note)

const noteOut = (n) => ({
  id: n.id, text: n.text, color: n.color, buddy: n.buddy, pinned: !!n.pinned, deleted: !!n.deleted,
  created: n.created, updated: n.updated, reminders: JSON.parse(n.reminders),
});

app.get('/api/notes', auth, (req, res) => {
  const since = +req.query.since || 0;
  const rows = db.prepare('SELECT * FROM notes WHERE user_id = ? AND updated > ? ORDER BY updated DESC').all(req.user.id, since);
  res.json({ notes: rows.map(noteOut), now: now() });
});

app.put('/api/notes/:id', auth, (req, res) => {
  const id = String(req.params.id);
  if (!/^[\w-]{1,40}$/.test(id)) return res.status(400).json({ error: 'Bad note id.' });
  const b = req.body || {};
  const existing = db.prepare('SELECT * FROM notes WHERE user_id = ? AND id = ?').get(req.user.id, id);
  if (!existing && db.prepare('SELECT COUNT(*) AS c FROM notes WHERE user_id = ?').get(req.user.id).c >= 5000) {
    return res.status(400).json({ error: 'You have reached the note limit.' });
  }
  const updated = Math.min(+b.updated || now(), now() + 6e4);
  if (existing && existing.updated > updated) return res.status(409).json({ note: noteOut(existing) });
  const note = {
    id,
    text: String(b.text ?? existing?.text ?? '').slice(0, 100000),
    color: String(b.color ?? existing?.color ?? 'none').slice(0, 16),
    buddy: String(b.buddy ?? existing?.buddy ?? '').slice(0, 40),
    pinned: b.pinned ?? !!existing?.pinned,
    deleted: !!b.deleted,
  };
  // Desktop clients send their own reminder state (fired/snoozed); web edits get reminders parsed here.
  const prev = existing ? JSON.parse(existing.reminders) : [];
  const reminders = Array.isArray(b.reminders) ? b.reminders.slice(0, 500) : parseNote(note, prev);
  db.prepare(`INSERT INTO notes (id, user_id, text, color, buddy, pinned, reminders, deleted, created, updated)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id, id) DO UPDATE SET text = excluded.text, color = excluded.color, buddy = excluded.buddy,
              pinned = excluded.pinned, reminders = excluded.reminders, deleted = excluded.deleted, updated = excluded.updated`)
    .run(id, req.user.id, note.text, note.color, note.buddy, note.pinned ? 1 : 0, JSON.stringify(reminders).slice(0, 500000), note.deleted ? 1 : 0, existing?.created || +b.created || now(), updated);
  res.json({ note: noteOut(db.prepare('SELECT * FROM notes WHERE user_id = ? AND id = ?').get(req.user.id, id)) });
});

// --- store

app.get('/api/catalog', optionalAuth, (req, res) => {
  const cat = catalog();
  const owned = new Set(ownedItems(req.user?.id));
  res.json({
    currency: cat.currency,
    store: STORE,
    testMode: STORE === 'test',
    bundle: { ...cat.bundle, owned: cat.items.every((i) => owned.has(i.id)) },
    items: cat.items.map((i) => ({ ...i, owned: owned.has(i.id) })),
  });
});

app.post('/api/store/checkout', auth, rateLimit('checkout', 20, 15 * 6e4), wrap(async (req, res) => {
  const cat = catalog();
  const item = req.body.item === cat.bundle.id ? cat.bundle : cat.items.find((i) => i.id === req.body.item);
  if (!item) return res.status(404).json({ error: 'That buddy is not in the store.' });
  if (item.price === 0 || ownedItems(req.user.id).includes(item.id)) return res.json({ owned: true });
  if (STORE === 'closed') return res.status(503).json({ error: 'The buddy store opens soon. Check back shortly!' });
  if (STORE === 'test') {
    grant(req.user.id, item.id, 'test-mode');
    return res.json({ granted: true, testMode: true });
  }
  const form = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': cat.currency,
    'line_items[0][price_data][unit_amount]': String(item.price),
    'line_items[0][price_data][product_data][name]': `Peeky — ${item.name}${item.kind ? ` the ${item.kind}` : ''}`,
    success_url: `${BASE}/api/store/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE}/app#buddies`,
    client_reference_id: req.user.id,
    customer_email: req.user.email,
    'metadata[item]': item.id,
    'payment_intent_data[metadata][item]': item.id,
    'payment_intent_data[metadata][user]': req.user.id,
  });
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${STRIPE_KEY}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': crypto.randomUUID() },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const s = await r.json();
  if (!r.ok) return res.status(502).json({ error: s.error?.message || 'The payment provider is unavailable.' });
  res.json({ url: s.url });
}));

// Fast path after Checkout; the webhook grants the purchase even if the buyer never comes back here.
app.get('/api/store/success', wrap(async (req, res) => {
  if (!STRIPE_KEY || !req.query.session_id) return res.redirect('/app#buddies');
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(req.query.session_id)}`, {
    headers: { authorization: `Bearer ${STRIPE_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const s = await r.json();
  if (r.ok && s.payment_status === 'paid' && s.client_reference_id && s.metadata?.item) {
    grant(s.client_reference_id, s.metadata.item, s.id);
    return res.redirect(`/app#buddies?purchased=${encodeURIComponent(s.metadata.item)}`);
  }
  res.redirect('/app#buddies');
}));

// --- daily routine from Google Sheets

async function syncSheet(userId, url) {
  try {
    const items = await fetchRoutine(url);
    db.prepare(`INSERT INTO sheets (user_id, url, items, error, synced) VALUES (?, ?, ?, NULL, ?)
                ON CONFLICT (user_id) DO UPDATE SET url = excluded.url, items = excluded.items, error = NULL, synced = excluded.synced`)
      .run(userId, url, JSON.stringify(items.slice(0, 500)), now());
    return { items };
  } catch (e) {
    // Only an already-connected sheet records the error; a bad new link is never saved.
    db.prepare('UPDATE sheets SET error = ? WHERE user_id = ? AND url = ?').run(e.message, userId, url);
    return { error: e.message };
  }
}
const routineOut = (userId) => {
  const s = db.prepare('SELECT * FROM sheets WHERE user_id = ?').get(userId);
  return s ? { url: s.url, items: JSON.parse(s.items), error: s.error, synced: s.synced } : { url: null, items: [] };
};

app.get('/api/routine', auth, (req, res) => res.json(routineOut(req.user.id)));
app.post('/api/routine', auth, rateLimit('sheet', 30, 15 * 6e4), wrap(async (req, res) => {
  const r = await syncSheet(req.user.id, String(req.body.url || '').slice(0, 1000));
  if (r.error) return res.status(400).json({ error: r.error, ...routineOut(req.user.id) });
  res.json(routineOut(req.user.id));
}));
app.post('/api/routine/sync', auth, rateLimit('sheet', 30, 15 * 6e4), wrap(async (req, res) => {
  const s = db.prepare('SELECT url FROM sheets WHERE user_id = ?').get(req.user.id);
  if (!s) return res.status(404).json({ error: 'No sheet connected.' });
  const r = await syncSheet(req.user.id, s.url);
  res.status(r.error ? 400 : 200).json({ ...(r.error ? { error: r.error } : {}), ...routineOut(req.user.id) });
}));
app.delete('/api/routine', auth, (req, res) => {
  db.prepare('DELETE FROM sheets WHERE user_id = ?').run(req.user.id);
  res.json({ url: null, items: [] });
});

// Keep every connected sheet fresh, a few at a time.
setInterval(async () => {
  for (const s of db.prepare('SELECT user_id, url FROM sheets').all()) await syncSheet(s.user_id, s.url);
}, 15 * 6e4).unref();

// Housekeeping: expired sessions, reset links and sign-in codes.
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(now() - SESSION_IDLE);
  db.prepare('DELETE FROM password_resets WHERE created < ?').run(now() - 36e5);
  db.prepare('DELETE FROM device_codes WHERE created < ?').run(now() - 15 * 6e4);
  for (const [k, b] of buckets) if (now() - b.at > 36e5) buckets.delete(k);
}, 36e5).unref();

// --- linking the desktop app (device code flow)

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const userCode = () => Array.from(crypto.randomBytes(8), (b, i) => (i === 4 ? '-' : '') + CODE_CHARS[b % CODE_CHARS.length]).join('');

app.post('/api/device/start', rateLimit('device', 30, 15 * 6e4), (req, res) => {
  const deviceCode = crypto.randomBytes(32).toString('base64url');
  const code = userCode();
  db.prepare('INSERT INTO device_codes (device_code, user_code, label, created) VALUES (?, ?, ?, ?)').run(sha256(deviceCode), code, String(req.body.label || 'Computer').slice(0, 60), now());
  res.json({ deviceCode, userCode: code, verifyUrl: `${BASE}/link?code=${code}`, interval: 2, expiresIn: 600 });
});

app.post('/api/device/poll', rateLimit('poll', 600, 15 * 6e4), (req, res) => {
  const row = db.prepare('SELECT * FROM device_codes WHERE device_code = ?').get(sha256(String(req.body.deviceCode || '')));
  if (!row || now() - row.created > 10 * 6e4) return res.status(410).json({ status: 'expired' });
  if (!row.user_id) return res.json({ status: 'pending' });
  db.prepare('DELETE FROM device_codes WHERE device_code = ?').run(row.device_code);
  res.json({ status: 'ok', token: createSession(row.user_id, 'desktop', row.label) });
});

app.get('/api/device/:code', auth, (req, res) => {
  const row = db.prepare('SELECT label, created FROM device_codes WHERE user_code = ?').get(String(req.params.code).toUpperCase());
  if (!row || now() - row.created > 10 * 6e4) return res.status(404).json({ error: 'This code has expired. Start sign-in again from the app.' });
  res.json({ label: row.label });
});

app.post('/api/device/approve', auth, rateLimit('approve', 30, 15 * 6e4), (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM device_codes WHERE user_code = ?').get(code);
  if (!row || row.user_id || now() - row.created > 10 * 6e4) return res.status(404).json({ error: 'This code has expired. Start sign-in again from the app.' });
  db.prepare('UPDATE device_codes SET user_id = ? WHERE user_code = ?').run(req.user.id, code);
  res.json({ ok: true, label: row.label });
});

app.get('/api/devices', auth, (req, res) => {
  const rows = db.prepare("SELECT token, label, created, last_seen FROM sessions WHERE user_id = ? AND kind = 'desktop' ORDER BY last_seen DESC").all(req.user.id);
  res.json({ devices: rows.map((r) => ({ id: r.token.slice(0, 16), label: r.label, created: r.created, lastSeen: r.last_seen })) });
});

app.delete('/api/devices/:id', auth, (req, res) => {
  const id = String(req.params.id);
  if (/^[0-9a-f]{16}$/.test(id)) db.prepare("DELETE FROM sessions WHERE user_id = ? AND kind = 'desktop' AND substr(token, 1, 16) = ?").run(req.user.id, id);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, 'web', '404.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? 'Bad request.' : 'Something went wrong.' });
});

const server = app.listen(PORT, () => {
  console.log(`Peeky server on ${BASE} (${PROD ? 'production' : 'development'})`);
  console.log(`  store: ${STORE}${STORE === 'live' && !STRIPE_WEBHOOK_SECRET ? ' — set STRIPE_WEBHOOK_SECRET so purchases are never missed' : ''}`);
  console.log(`  email: ${mail.configured ? 'Resend' : 'printed to this log (set RESEND_API_KEY)'}`);
  if (PROD && !BASE.startsWith('https')) console.warn('  WARNING: PUBLIC_URL should be https:// in production');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
