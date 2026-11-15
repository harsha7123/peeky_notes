const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseNote, keyOf, CHECKBOX, registerBuddyIds } = require('./src/parse');

// Packaged builds get the production address baked into package.json by `npm run dist`.
const SERVER = (process.env.PEEKY_SERVER || require('./package.json').peeky?.server || 'http://localhost:8787').replace(/\/$/, '');
const PANEL_W = 360, PILL_W = 12, PILL_H = 96;
const BUDDY_W = 420, BUDDY_H = 520;
const PRELOAD = path.join(__dirname, 'src', 'preload.js');
const FREE_BUDDIES = ['robot', 'cat'];
const DEFAULT_SETTINGS = { buddy: 'robot', voice: true, chime: true, openAtLogin: false };
// Gentle recurring nudges. `every` is the default interval in minutes.
const NUDGES = {
  water: { tag: 'Water break', text: 'Time for a water break.', body: 'A glass of water now keeps the afternoon headache away.', every: 60 },
  stretch: { tag: 'Stretch', text: 'Stand up and stretch.', body: 'Roll your shoulders and reach for the ceiling for a minute.', every: 90 },
  eyes: { tag: 'Eye break', text: 'Rest your eyes.', body: 'Look at something far away for 20 seconds.', every: 20 },
  posture: { tag: 'Posture', text: 'Check your posture.', body: 'Shoulders back, feet flat, screen at eye level.', every: 45 },
};
const defaultNudges = () => Object.fromEntries(Object.entries(NUDGES).map(([k, n]) => [k, { on: false, every: n.every }]));
const WELCOME = `Welcome to Peeky 👋
Hover the small handle on the right edge of your screen to peek. Ctrl+Shift+Space toggles me.

[ ] Say hi to your new buddy in 1 min
[ ] Stretch your legs in 30 min
[ ] Plan tomorrow at 8pm
[x] Install Peeky`;

let panel, buddyWin, tray, state, token = null, saveTimer, pushTimer, panelOpen = false;
let buddyReady = false, signingIn = null;
const buddyQueue = [];

const file = (name) => path.join(app.getPath('userData'), name);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const titleOf = (n) => (n.text.split('\n').find((l) => l.trim()) || 'Untitled').replace(CHECKBOX, '').slice(0, 60);
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function emptyState() {
  return {
    notes: [], settings: { ...DEFAULT_SETTINGS }, account: null, online: true,
    owned: [...FREE_BUDDIES], catalog: [], routine: { url: null, items: [] },
    routineLog: {}, timers: [], dirty: [], deleted: [], lastPull: 0, server: SERVER,
    nudges: defaultNudges(), nudgeNext: {}, focus: null, dndUntil: 0, stats: { days: {} },
  };
}

function makeNote(text = '') {
  const n = { id: uid(), text, color: 'none', buddy: '', pinned: false, created: Date.now(), updated: Date.now(), reminders: [] };
  n.reminders = parseNote(n);
  return n;
}

// ---------- local persistence ----------

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file('peeky-data.json'), 'utf8')); } catch {}
  state = { ...emptyState(), ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings }, server: SERVER, online: true };
  state.nudges = { ...defaultNudges(), ...saved.nudges };
  state.stats = { days: {}, ...saved.stats };
  registerBuddyIds((state.catalog || []).map((i) => i.id));
  // Reminders that went off more than 6h ago while the app was closed count as missed, not replayed.
  const cutoff = Date.now() - 6 * 36e5;
  for (const n of state.notes) for (const r of n.reminders) if (!r.fired && r.due < cutoff) r.fired = true;
  try {
    const raw = fs.readFileSync(file('session.bin'));
    token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { token = null; }
}

function writeNow() {
  clearTimeout(saveTimer);
  fs.writeFileSync(file('peeky-data.json'), JSON.stringify(state));
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}
function saveToken(t) {
  token = t;
  if (!t) { fs.rmSync(file('session.bin'), { force: true }); return; }
  fs.writeFileSync(file('session.bin'), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t));
}

function broadcast() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('state', state);
  const pending = state.notes.flatMap((n) => n.reminders).filter((r) => !r.fired && !r.done).length;
  tray?.setToolTip(state.account ? `Peeky — ${pending} upcoming reminder${pending === 1 ? '' : 's'}` : 'Peeky — not signed in');
}

// ---------- cloud ----------

async function api(p, { method = 'GET', body, auth = true } = {}) {
  const res = await fetch(SERVER + p, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) { signOutLocal(); throw new Error('signed out'); }
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}

async function refreshAccount() {
  const [me, cat, routine] = await Promise.all([api('/api/me'), api('/api/catalog'), api('/api/routine')]);
  state.account = { user: me.user, sheet: me.sheet, testMode: cat.testMode };
  state.owned = me.owned;
  state.catalog = cat.items;
  registerBuddyIds(cat.items.map((i) => i.id));
  state.routine = { url: routine.url, items: routine.items || [], error: routine.error, synced: routine.synced };
  Object.assign(state.settings, me.settings);
}

// Server copy wins unless we have unsent local edits; reminder state (fired/snoozed) stays local.
function mergeNote(remote) {
  const local = state.notes.find((n) => n.id === remote.id);
  if (remote.deleted) {
    if (local && !state.dirty.includes(local.id)) state.notes = state.notes.filter((n) => n.id !== remote.id);
    return;
  }
  if (!local) {
    const n = { ...remote };
    n.reminders = parseNote(n, remote.reminders || []);
    state.notes.push(n);
  } else if (remote.updated > local.updated && !state.dirty.includes(local.id)) {
    Object.assign(local, { text: remote.text, color: remote.color, buddy: remote.buddy, pinned: remote.pinned, updated: remote.updated });
    local.reminders = parseNote(local, local.reminders);
  }
}

async function pull() {
  const { notes, now } = await api(`/api/notes?since=${state.lastPull}`);
  notes.forEach(mergeNote);
  state.lastPull = now - 5000;
}

async function push() {
  for (const id of [...state.dirty]) {
    const n = state.notes.find((x) => x.id === id);
    state.dirty = state.dirty.filter((x) => x !== id);
    if (!n) continue;
    try {
      await api(`/api/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: { text: n.text, color: n.color, buddy: n.buddy, pinned: n.pinned, created: n.created, updated: n.updated, reminders: n.reminders } });
    } catch (e) {
      if (e.status === 409) mergeNote(e.data.note);
      else { state.dirty.push(id); throw e; }
    }
  }
  for (const t of [...state.deleted]) {
    await api(`/api/notes/${encodeURIComponent(t.id)}`, { method: 'PUT', body: { deleted: true, updated: t.updated } });
    state.deleted = state.deleted.filter((x) => x.id !== t.id);
  }
}

let syncing = false;
async function sync({ full = false } = {}) {
  if (!token || syncing) return;
  syncing = true;
  try {
    if (full || !state.account) await refreshAccount();
    await push();
    await pull();
    state.online = true;
  } catch (e) {
    if (e.message !== 'signed out') state.online = false;
  } finally {
    syncing = false;
    save();
    broadcast();
  }
}

function markDirty(id) {
  if (!state.dirty.includes(id)) state.dirty.push(id);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync(), 1500);
}

async function startSignIn() {
  if (signingIn) { shell.openExternal(signingIn.verifyUrl); return signingIn; }
  const d = await api('/api/device/start', { method: 'POST', body: { label: `${os.hostname()} (${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'})` }, auth: false });
  signingIn = { userCode: d.userCode, verifyUrl: d.verifyUrl };
  // PEEKY_DEBUG_SIGNIN (development only): print the code instead of opening a browser, for scripted tests.
  if (process.env.PEEKY_DEBUG_SIGNIN) console.log(`[signin] code ${d.userCode}`);
  else shell.openExternal(d.verifyUrl);
  const until = Date.now() + d.expiresIn * 1000;
  (async () => {
    while (signingIn && Date.now() < until) {
      await new Promise((r) => setTimeout(r, d.interval * 1000));
      if (!signingIn) return;
      const r = await api('/api/device/poll', { method: 'POST', body: { deviceCode: d.deviceCode }, auth: false }).catch(() => ({ status: 'pending' }));
      if (r.status === 'ok') {
        signingIn = null;
        saveToken(r.token);
        await finishSignIn();
        panel?.focus();
        return;
      }
      if (r.status === 'expired') break;
    }
    signingIn = null;
    panel?.webContents.send('auth', { status: 'expired' });
  })();
  return signingIn;
}

async function finishSignIn() {
  state = { ...emptyState(), settings: { ...state.settings }, nudges: state.nudges };
  await sync({ full: true });
  if (state.account && !state.notes.length) {
    const n = makeNote(WELCOME);
    state.notes.push(n);
    markDirty(n.id);
  }
  panel?.webContents.send('auth', { status: 'ok' });
  broadcast();
}

// Local sign-out: forget the token and this account's cached data.
function signOutLocal() {
  saveToken(null);
  signingIn = null;
  state = { ...emptyState(), settings: { ...DEFAULT_SETTINGS, openAtLogin: state.settings.openAtLogin } };
  save();
  broadcast();
}

// ---------- reminder helpers ----------

function findReminder(id) {
  for (const n of state.notes) {
    const r = n.reminders.find((x) => x.id === id);
    if (r) return [n, r];
  }
  return [];
}

// Ticks or unticks the reminder's line in the note text; the text stays the source of truth.
function setChecked(n, r, checked) {
  const lines = n.text.split('\n');
  const base = r.key.replace(/~~\d+$/, '');
  const i = keyOf(lines[r.line] || '') === base ? r.line : lines.findIndex((l) => keyOf(l) === base);
  if (i < 0) return;
  const line = lines[i];
  const m = line.match(CHECKBOX);
  if (m) lines[i] = line.replace(CHECKBOX, `${m[1]}[${checked ? 'x' : ' '}] `);
  else if (checked) lines[i] = line.replace(/^(\s*(?:[-*•]\s*)?)/, '$1[x] ');
  n.text = lines.join('\n');
  n.updated = Date.now();
  n.reminders = parseNote(n, n.reminders);
  markDirty(n.id);
}

// Every completed thing counts toward today's total (and the streak shown in the panel).
function countDone() {
  const k = dayKey();
  state.stats.days[k] = (state.stats.days[k] || 0) + 1;
  const keep = Object.keys(state.stats.days).slice(-120);
  state.stats.days = Object.fromEntries(keep.map((d) => [d, state.stats.days[d]]));
}

// A buddy the account doesn't own falls back to the default (or the free robot).
function pickBuddy(...wanted) {
  for (const k of wanted) if (k && state.owned.includes(k)) return k;
  return state.owned.includes(state.settings.buddy) ? state.settings.buddy : 'robot';
}

// ---------- edge panel ----------

function panelBounds(open) {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.min(760, wa.height - 40);
  const cy = wa.y + Math.round(wa.height / 2);
  return open
    ? { x: wa.x + wa.width - PANEL_W, y: cy - Math.round(h / 2), width: PANEL_W, height: h }
    : { x: wa.x + wa.width - PILL_W, y: cy - PILL_H / 2, width: PILL_W, height: PILL_H };
}

function createPanel() {
  panel = new BrowserWindow({
    ...panelBounds(false),
    frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD },
  });
  panel.setAlwaysOnTop(true, 'floating');
  panel.loadFile(path.join(__dirname, 'src', 'panel.html'));
  panel.once('ready-to-show', () => {
    panel.showInactive();
    if (!token) panel.webContents.send('panel', 'toggle');
  });
  panel.on('blur', () => panel.webContents.send('panel', 'blur'));
}

// ---------- 3D buddy overlay ----------

const common = () => ({ settings: state.settings, catalog: state.catalog, server: SERVER });

function payload(n, r) {
  return { id: r.id, kind: 'reminder', text: r.text, due: r.due, noteTitle: titleOf(n), buddy: pickBuddy(r.buddy, n.buddy), ...common() };
}

function showBuddy(p) {
  buddyQueue.push(p);
  if (!buddyWin) createBuddy();
  else if (buddyReady) flushBuddy();
}

function flushBuddy() {
  while (buddyQueue.length) buddyWin.webContents.send('buddy:show', buddyQueue.shift());
}

// Bottom-right corner, stepping left of the notes panel while it's open.
function buddyBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const right = wa.x + wa.width - (panelOpen ? PANEL_W : 24);
  return { x: right - BUDDY_W, y: wa.y + wa.height - BUDDY_H, width: BUDDY_W, height: BUDDY_H };
}
function placeBuddy() {
  if (buddyWin && !buddyWin.isDestroyed()) buddyWin.setBounds(buddyBounds());
}

function createBuddy() {
  buddyWin = new BrowserWindow({
    ...buddyBounds(),
    frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, focusable: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD },
  });
  buddyWin.setAlwaysOnTop(true, 'screen-saver');
  buddyWin.setVisibleOnAllWorkspaces(true);
  // Transparent areas let clicks through to whatever is underneath; the page turns this off over the buddy/card.
  buddyWin.setIgnoreMouseEvents(true, { forward: true });
  buddyWin.loadFile(path.join(__dirname, 'src', 'buddy.html'));
  buddyWin.once('ready-to-show', () => buddyWin.showInactive());
  // Feed the cursor position so the buddy's eyes can follow it across the whole screen.
  const cursorFeed = setInterval(() => {
    if (!buddyReady) return;
    const p = screen.getCursorScreenPoint(), b = buddyWin.getBounds();
    buddyWin.webContents.send('buddy:cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 50);
  buddyWin.on('closed', () => { clearInterval(cursorFeed); buddyWin = null; buddyReady = false; });
}

function tick() {
  if (!state.account) return;
  const now = Date.now();
  // Paused: hold everything. Note reminders fire as soon as the pause ends.
  if (state.dndUntil > now) return;
  let changed = false;

  for (const n of state.notes) for (const r of n.reminders) {
    if (r.fired || r.done || r.due > now) continue;
    r.fired = true;
    changed = true;
    showBuddy(payload(n, r));
    markDirty(n.id);
  }

  // Daily routine from Google Sheets: each row fires once per matching day, within 30 min of its time.
  const today = dayKey();
  for (const k of Object.keys(state.routineLog)) if (!k.endsWith(`@${today}`)) delete state.routineLog[k];
  for (const it of state.routine.items) {
    if (!it.days.includes(new Date().getDay())) continue;
    const [h, m] = it.time.split(':').map(Number);
    const due = new Date().setHours(h, m, 0, 0);
    const key = `${it.id}@${today}`;
    if (now < due || now - due > 30 * 6e4 || state.routineLog[key]) continue;
    state.routineLog[key] = 'shown';
    changed = true;
    showBuddy({ id: `routine:${key}`, kind: 'routine', text: it.task, due, noteTitle: 'Daily routine', buddy: pickBuddy(it.buddy), ...common() });
  }

  // Focus session finished.
  if (state.focus && now >= state.focus.until) {
    const minutes = state.focus.minutes;
    state.focus = null;
    changed = true;
    countDone();
    showBuddy({ id: 'focus', kind: 'focus', minutes, text: 'take a break', due: now, buddy: pickBuddy(), ...common() });
  }

  // Healthy nudges — held back while a focus session is running.
  if (!state.focus) {
    for (const [key, cfg] of Object.entries(state.nudges)) {
      if (!cfg.on || !NUDGES[key]) continue;
      if (!state.nudgeNext[key]) { state.nudgeNext[key] = now + cfg.every * 6e4; changed = true; continue; }
      if (now < state.nudgeNext[key]) continue;
      state.nudgeNext[key] = now + cfg.every * 6e4;
      changed = true;
      const n = NUDGES[key];
      showBuddy({ id: `nudge:${key}`, kind: 'nudge', tag: n.tag, text: n.text, body: n.body, due: now, buddy: pickBuddy(), ...common() });
    }
  }

  // Snoozed routine items.
  for (const t of state.timers.filter((x) => x.due <= now)) {
    state.timers = state.timers.filter((x) => x !== t);
    changed = true;
    showBuddy({ kind: 'routine', ...t.payload, due: now, ...common() });
  }

  if (changed) { save(); broadcast(); }
}

// ---------- tray ----------

function trayIcon() {
  const s = 32, buf = Buffer.alloc(s * s * 4);
  const put = (x, y, [r, g, b]) => { const i = (y * s + x) * 4; buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; };
  const within = (x, y, cx, cy, rad) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const cx = Math.min(Math.max(x, 8), 23), cy = Math.min(Math.max(y, 8), 23);
    if (!within(x, y, cx, cy, 6.5)) continue;
    put(x, y, [29, 29, 31]);
    for (const ex of [11, 20]) if ((x - ex) ** 2 / 6.5 + (y - 15.5) ** 2 / 16 <= 1) put(x, y, [255, 255, 255]);
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s, scaleFactor: 2 });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Peeky', click: () => panel.webContents.send('panel', 'toggle') },
    { label: 'New Note', click: () => panel.webContents.send('panel', 'new') },
    { label: 'Preview My Buddy', click: () => showBuddy(testPayload()) },
    { label: 'Open Peeky on the Web', click: () => shell.openExternal(`${SERVER}/app`) },
    { type: 'separator' },
    { label: 'Quit Peeky', click: () => app.quit() },
  ]));
  tray.on('click', () => panel.webContents.send('panel', 'toggle'));
}

const testPayload = (buddy) => ({ id: 'test', kind: 'test', test: true, text: 'drink a glass of water', due: Date.now(), noteTitle: 'Preview', buddy: pickBuddy(buddy), ...common() });

// ---------- IPC ----------

ipcMain.handle('state:get', () => state);
ipcMain.handle('panel:expand', (_e, focus) => {
  panelOpen = true;
  panel.setBounds(panelBounds(true));
  placeBuddy();
  if (focus) panel.focus();
  sync();
});
ipcMain.handle('panel:collapse', () => {
  panelOpen = false;
  panel.setBounds(panelBounds(false));
  placeBuddy();
});

ipcMain.handle('auth:start', async () => {
  try { return await startSignIn(); } catch { return { error: "Couldn't reach Peeky. Check your internet connection and try again." }; }
});
ipcMain.handle('auth:cancel', () => { signingIn = null; });
ipcMain.handle('auth:signout', async () => {
  await api('/api/auth/signout', { method: 'POST' }).catch(() => {});
  signOutLocal();
});
ipcMain.handle('open:web', (_e, p) => shell.openExternal(SERVER + (String(p).startsWith('/') ? p : '/app')));

ipcMain.handle('note:create', () => {
  const n = makeNote('');
  state.notes.unshift(n);
  save(); broadcast();
  return n;
});
ipcMain.handle('note:update', (_e, id, patch) => {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return null;
  for (const k of ['text', 'color', 'buddy', 'pinned']) if (k in patch) n[k] = patch[k];
  n.updated = Date.now();
  if ('text' in patch) n.reminders = parseNote(n, n.reminders);
  if (n.text.trim()) markDirty(n.id);
  save(); broadcast();
  return n;
});
ipcMain.handle('note:delete', (_e, id) => {
  state.notes = state.notes.filter((n) => n.id !== id);
  state.dirty = state.dirty.filter((x) => x !== id);
  state.deleted.push({ id, updated: Date.now() });
  save(); broadcast();
  sync();
});
ipcMain.handle('settings:set', async (_e, patch) => {
  Object.assign(state.settings, patch);
  if ('openAtLogin' in patch) {
    app.setLoginItemSettings({ openAtLogin: !!patch.openAtLogin, path: process.execPath, args: app.isPackaged ? [] : [path.resolve(__dirname)] });
  }
  save(); broadcast();
  const remote = Object.fromEntries(Object.entries(patch).filter(([k]) => ['buddy', 'voice', 'chime'].includes(k)));
  if (Object.keys(remote).length) await api('/api/settings', { method: 'PATCH', body: remote }).catch(() => {});
});
ipcMain.handle('reminder:action', (_e, id, action, minutes) => {
  if (id.startsWith('nudge:')) {
    const key = id.slice(6);
    if (action === 'done') countDone();
    else if (action === 'snooze') state.nudgeNext[key] = Date.now() + (minutes || 10) * 6e4;
    save(); broadcast();
    return;
  }
  if (id === 'focus') {
    const m = state.lastFocus || 25;
    if (action === 'again') state.focus = { minutes: m, until: Date.now() + m * 6e4 };
    save(); broadcast();
    return;
  }
  if (id.startsWith('routine:')) {
    const key = id.slice(8);
    if (action === 'done') { state.routineLog[key] = 'done'; countDone(); }
    else if (action === 'undone') state.routineLog[key] = 'shown';
    else if (action === 'snooze') {
      const [rid] = key.split('@');
      const it = state.routine.items.find((x) => x.id === rid);
      if (it) state.timers.push({ due: Date.now() + (minutes || 10) * 6e4, payload: { id, text: it.task, noteTitle: 'Daily routine', buddy: pickBuddy(it.buddy) } });
    }
    save(); broadcast();
    return;
  }
  const [n, r] = findReminder(id);
  if (!r) return;
  if (action === 'test') return showBuddy({ ...payload(n, r), kind: 'test', test: true });
  if (action === 'done') { if (!r.done) countDone(); setChecked(n, r, true); }
  else if (action === 'undone') setChecked(n, r, false);
  else if (action === 'snooze') {
    r.due = Date.now() + (minutes || 10) * 6e4;
    r.fired = false;
    r.snoozed = true;
    markDirty(n.id);
  }
  save(); broadcast();
});
ipcMain.handle('buddy:test', (_e, buddy) => showBuddy(testPayload(buddy)));

// Quick add: "call mom at 5pm" becomes a checkbox line in the Inbox note (and a reminder if it has a time).
ipcMain.handle('quick:add', (_e, text) => {
  const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!line) return null;
  let inbox = state.notes.find((n) => n.id === 'inbox');
  if (!inbox) {
    inbox = { id: 'inbox', text: 'Inbox', color: 'none', buddy: '', pinned: true, created: Date.now(), updated: Date.now(), reminders: [] };
    state.notes.unshift(inbox);
  }
  inbox.text = `${inbox.text.replace(/\s+$/, '')}\n[ ] ${line}`;
  inbox.updated = Date.now();
  inbox.reminders = parseNote(inbox, inbox.reminders);
  markDirty(inbox.id);
  save(); broadcast();
  const last = inbox.text.split('\n').length - 1;
  const added = inbox.reminders.find((x) => x.line === last);
  return added ? { text: added.text, due: added.due } : { text: line, due: null };
});

ipcMain.handle('nudge:set', (_e, key, patch) => {
  if (!NUDGES[key]) return;
  const cfg = state.nudges[key];
  if (typeof patch.on === 'boolean') cfg.on = patch.on;
  if (patch.every) cfg.every = Math.min(240, Math.max(5, +patch.every || NUDGES[key].every));
  state.nudgeNext[key] = cfg.on ? Date.now() + cfg.every * 6e4 : 0;
  save(); broadcast();
});

ipcMain.handle('focus:start', (_e, minutes) => {
  const m = Math.min(180, Math.max(1, +minutes || 25));
  state.focus = { minutes: m, until: Date.now() + m * 6e4 };
  state.lastFocus = m;
  save(); broadcast();
});
ipcMain.handle('focus:stop', () => { state.focus = null; save(); broadcast(); });

// Pause every reminder for a while (0 = resume now).
ipcMain.handle('dnd:set', (_e, minutes) => {
  state.dndUntil = minutes ? Date.now() + minutes * 6e4 : 0;
  save(); broadcast();
});
ipcMain.on('buddy:ready', () => { buddyReady = true; flushBuddy(); });
ipcMain.on('buddy:closed', () => { if (!buddyQueue.length) buddyWin?.close(); });
ipcMain.on('buddy:ignore', (e, ignore) => {
  BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(ignore, { forward: true });
});

// ---------- lifecycle ----------

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => panel?.webContents.send('panel', 'toggle'));
  app.whenReady().then(() => {
    app.setAppUserModelId('com.peeky.app');
    if (process.env.PEEKY_DEBUG) {
      app.on('web-contents-created', (_e, wc) => wc.on('console-message', (_ev, level, msg, line, src) => {
        console.log(`[renderer:${level}] ${msg} (${path.basename(src)}:${line})`);
      }));
    }
    load();
    createPanel();
    createTray();
    globalShortcut.register('CommandOrControl+Shift+Space', () => panel.webContents.send('panel', 'toggle'));
    globalShortcut.register('CommandOrControl+Alt+N', () => panel.webContents.send('panel', 'new'));
    screen.on('display-metrics-changed', () => panel.webContents.send('panel', 'reflow'));
    sync({ full: true });
    if (!token && process.env.PEEKY_DEBUG_SIGNIN) startSignIn();
    // PEEKY_DEBUG_AUTODONE=<seconds> (development only): press the buddy card's main button after a delay, for scripted tests.
    if (process.env.PEEKY_DEBUG_AUTODONE) app.on('browser-window-created', (_e, w) => w.webContents.once('did-finish-load', () => {
      if (!w.webContents.getURL().endsWith('buddy.html')) return;
      w.webContents.executeJavaScript(`setTimeout(() => document.querySelector('.actions .yes')?.click(), ${+process.env.PEEKY_DEBUG_AUTODONE * 1000})`);
    }));
    // PEEKY_DEBUG_VIEW=agenda|buddy|notes (development only): open the panel on that tab, for screenshots.
    if (process.env.PEEKY_DEBUG_VIEW) setTimeout(() => {
      panel.webContents.send('panel', 'toggle');
      panel.webContents.executeJavaScript(`setTimeout(() => document.querySelector('[data-view="${process.env.PEEKY_DEBUG_VIEW.replace(/\W/g, '')}"]')?.click(), 700)`);
    }, 3500);
    setInterval(tick, 2000);
    setInterval(() => sync(), 60e3);                 // notes
    setInterval(() => sync({ full: true }), 5 * 60e3); // purchases, settings, routine
  });
  app.on('window-all-closed', () => {}); // lives in the tray
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (state) writeNow(); });
}
