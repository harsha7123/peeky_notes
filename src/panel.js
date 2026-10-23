import { createStage, BUDDIES, registerBuddies } from './buddies.js';

const $ = (s) => document.querySelector(s);
// Apple system colors, used only as small tag dots.
const TAGS = { none: '', red: '#ff3b30', orange: '#ff9500', yellow: '#ffcc00', green: '#34c759', blue: '#007aff', purple: '#af52de' };
const CHECKBOX = /^\s*(?:[-*•]\s*)?\[([ xX])\]/;
const PREFIX = /^\s*(?:[-*•]\s*)?(?:\[[ xX]\]\s*)?/;
const QUICK = [['To-do', 'todo'], ['In 15 min', ' in 15 min'], ['In 1 hour', ' in 1 hour'], ['5 PM', ' at 5pm'], ['Tonight', ' tonight'], ['Tomorrow', ' tomorrow 9am']];
const HEADINGS = { notes: 'Notes', edit: 'Notes', agenda: 'Reminders', buddy: 'Buddy', signin: 'Peeky' };

let S = { notes: [], settings: {} };
let view = 'notes', editingId = null, search = '', dirty = false, saveTimer = 0, stage = null;
const ed = $('#editor');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;
const note = (id) => S.notes.find((n) => n.id === id);
const titleOf = (n) => (n.text.split('\n').find((l) => l.trim()) || '').replace(PREFIX, '').replace(/^#+\s*/, '').slice(0, 60) || 'New Note';
const owns = (k) => !!k && BUDDIES[k] && (S.owned || []).includes(k);
const defaultBuddy = () => (owns(S.settings.buddy) ? S.settings.buddy : 'robot');
const buddyKey = (n, r) => (owns(r.buddy) ? r.buddy : owns(n.buddy) ? n.buddy : defaultBuddy());
const dayDiff = (a, b) => Math.round((new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / 864e5);
const fmtDur = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(m / 1440)} days`);
const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function fmtWhen(ms) {
  const diff = dayDiff(ms, Date.now());
  if (diff === 0) return `Today, ${timeOf(ms)}`;
  if (diff === 1) return `Tomorrow, ${timeOf(ms)}`;
  if (diff === -1) return `Yesterday, ${timeOf(ms)}`;
  if (diff > 1 && diff < 7) return `${new Date(ms).toLocaleDateString([], { weekday: 'long' })}, ${timeOf(ms)}`;
  return `${new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeOf(ms)}`;
}
function edited(ms) {
  const diff = dayDiff(ms, Date.now());
  if (diff === 0) return timeOf(ms);
  if (diff === -1) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
function rel(ms) {
  const m = Math.round((ms - Date.now()) / 6e4);
  if (Math.abs(m) < 1) return 'now';
  return m < 0 ? `${fmtDur(-m)} ago` : `in ${fmtDur(m)}`;
}
const allReminders = () => S.notes.flatMap((n) => n.reminders.map((r) => ({ n, r })));

// Small 3D portraits of every buddy (built-in and store models), rendered once each.
const faces = {}, portraits = {};
let rendering = Promise.resolve();
function renderPortraits() {
  rendering = rendering.then(async () => {
    const todo = Object.keys(BUDDIES).filter((k) => !faces[k]);
    if (!todo.length) return;
    const f = createStage(document.createElement('canvas'), { size: [96, 96], distance: 3.6, target: 1.3 });
    const p = createStage(document.createElement('canvas'), { size: [120, 120], distance: 4.3, target: 1.0 });
    for (const k of todo) { faces[k] = await f.snapshot(k); portraits[k] = await p.snapshot(k); }
    f.dispose();
    p.dispose();
    render();
  });
}

// ---------- peek open / close ----------

let open = false, pinned = false, closeTimer = 0, hoverTimer = 0;

async function openPanel(focus = false) {
  clearTimeout(closeTimer);
  if (open) { if (focus) peeky.expand(true); return; }
  open = true;
  await peeky.expand(focus);
  document.body.classList.add('open');
  render();
}
function scheduleClose(ms) {
  if (pinned) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closePanel, ms);
}
async function closePanel() {
  if (!open || pinned) return;
  await flush();
  open = false;
  document.body.classList.remove('open');
  stage?.setPaused(true);
  await sleep(280);
  if (!open) peeky.collapse();
}
const typing = () => document.activeElement === ed || document.activeElement === $('#search');

$('#pill').addEventListener('mouseenter', () => { hoverTimer = setTimeout(() => openPanel(), 140); });
$('#pill').addEventListener('mouseleave', () => clearTimeout(hoverTimer));
$('#pill').addEventListener('click', () => openPanel(true));
$('#sheet').addEventListener('mouseenter', () => clearTimeout(closeTimer));
document.documentElement.addEventListener('mouseleave', () => { if (!typing()) scheduleClose(600); });

function setPinned(b) {
  pinned = b;
  $('#btnPin').classList.toggle('on', b);
}
$('#btnPin').addEventListener('click', () => setPinned(!pinned));

peeky.onPanel(async (ev) => {
  if (ev === 'toggle') open ? (setPinned(false), closePanel()) : openPanel(true);
  else if (ev === 'new') { await openPanel(true); newNote(); }
  else if (ev === 'blur' && !$('#sheet').matches(':hover')) scheduleClose(250);
  else if (ev === 'reflow') open ? peeky.expand(false) : peeky.collapse();
});

// ---------- views ----------

function show(v) {
  if (view === 'edit' && v !== 'edit') leaveEditor();
  view = v;
  for (const s of document.querySelectorAll('.view')) s.classList.toggle('hidden', s.id !== `view-${v}`);
  for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('active', b.dataset.view === (v === 'edit' ? 'notes' : v));
  $('#heading').textContent = HEADINGS[v];
  stage?.setPaused(v !== 'buddy');
  render();
}
$('.seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });

function render() {
  const signedIn = !!S.account;
  document.body.classList.toggle('signed-out', !signedIn);
  if (!signedIn && view !== 'signin') return show('signin');
  if (signedIn && view === 'signin') return show('notes');
  $('#offline').classList.toggle('hidden', !signedIn || S.online !== false);
  renderBadge();
  if (view === 'notes') renderNotes();
  else if (view === 'edit') renderEditor();
  else if (view === 'agenda') renderAgenda();
  else if (view === 'buddy') renderBuddy();
}

// ---------- sign in (device flow: the browser approves this computer) ----------

function signinState(waitingCode, error = '') {
  $('#signinIdle').classList.toggle('hidden', !!waitingCode);
  $('#signinWait').classList.toggle('hidden', !waitingCode);
  $('#signinCode').textContent = waitingCode || '';
  $('#signinError').textContent = error;
}
$('#btnSignIn').addEventListener('click', async () => {
  signinState(null);
  const r = await peeky.signIn();
  if (r?.error) signinState(null, r.error);
  else signinState(r.userCode);
});
$('#btnReopen').addEventListener('click', () => peeky.signIn());
$('#btnCancelSignIn').addEventListener('click', () => { peeky.cancelSignIn(); signinState(null); });
$('#btnSignUp').addEventListener('click', () => peeky.openWeb('/signup'));
peeky.onAuth(({ status }) => {
  if (status === 'expired') signinState(null, 'That code expired. Try again.');
  else signinState(null);
});
$('#btnManage').addEventListener('click', () => peeky.openWeb('/app#account'));
$('#btnSignOut').addEventListener('click', () => { if (confirm('Sign out of Peeky on this computer?')) peeky.signOut(); });

function renderBadge() {
  const waiting = allReminders().filter(({ r }) => r.fired && !r.done).length;
  $('#badge').classList.toggle('hidden', !waiting);
  $('#pill').title = waiting ? `${waiting} reminder${waiting > 1 ? 's' : ''} waiting · Ctrl+Shift+Space` : 'Peeky Notes · Ctrl+Shift+Space';
}

function noteRow(n) {
  const lines = n.text.split('\n').filter((l) => l.trim());
  const boxes = lines.map((l) => l.match(CHECKBOX)).filter(Boolean);
  const checked = boxes.filter((m) => m[1] !== ' ').length;
  const nextR = n.reminders.filter((r) => !r.done && !r.fired).sort((a, b) => a.due - b.due)[0];
  const preview = lines.slice(1).map((l) => l.replace(PREFIX, '')).join(' ') || 'No additional text';
  const meta = [
    nextR ? `<span>${icon('clock')}${fmtWhen(nextR.due)}</span>` : '',
    boxes.length ? `<span>${checked} of ${boxes.length} done</span>` : '',
  ].join('');
  return `<div class="row note-row" data-id="${n.id}">
    <div class="t">${esc(titleOf(n))}</div>
    <div class="s"><b>${edited(n.updated)}</b>${esc(preview)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${TAGS[n.color] ? `<span class="tag-dot" style="background:${TAGS[n.color]}"></span>` : ''}
    <button class="pin-btn ${n.pinned ? 'on' : ''}" data-pin="${n.id}" title="${n.pinned ? 'Unpin' : 'Pin'}">${icon('pin')}</button>
  </div>`;
}

function renderNotes() {
  const q = search.toLowerCase();
  const notes = S.notes.filter((n) => !q || n.text.toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated);
  const pinnedNotes = notes.filter((n) => n.pinned), rest = notes.filter((n) => !n.pinned);
  const section = (label, list) => (list.length ? `<div class="group-label">${label}</div><div class="list">${list.map(noteRow).join('')}</div>` : '');
  $('#noteList').innerHTML = notes.length
    ? section('Pinned', pinnedNotes) + section(pinnedNotes.length ? 'Notes' : `${notes.length} Note${notes.length > 1 ? 's' : ''}`, rest)
    : `<div class="empty">${q ? 'No Results' : 'No Notes'}</div>`;
}

$('#noteList').addEventListener('click', (e) => {
  const pin = e.target.closest('[data-pin]');
  if (pin) { const n = note(pin.dataset.pin); peeky.updateNote(n.id, { pinned: !n.pinned }); return; }
  const row = e.target.closest('.note-row');
  if (row) openEditor(row.dataset.id);
});
$('#search').addEventListener('input', (e) => { search = e.target.value; renderNotes(); });

// ---------- editor ----------

$('#tags').innerHTML = Object.entries(TAGS).map(([k, c]) => `<span class="tag ${k === 'none' ? 'none' : ''}" data-tag="${k}" title="${k === 'none' ? 'No tag' : k}" style="${c ? `background:${c}` : ''}"></span>`).join('');
$('#noteBuddy').innerHTML = `<option value="">Default buddy</option>` + Object.entries(BUDDIES).map(([k, b]) => `<option value="${k}">${b.name} the ${b.kind}</option>`).join('');
$('#quick').innerHTML = QUICK.map(([label, v]) => `<button data-q="${esc(v)}">${label}</button>`).join('');

function openEditor(id) {
  editingId = id;
  ed.value = note(id).text;
  show('edit');
  ed.focus();
  ed.setSelectionRange(ed.value.length, ed.value.length);
}

function renderEditor() {
  const n = note(editingId);
  if (!n) { editingId = null; return show('notes'); }
  if (!dirty && ed.value !== n.text) {
    const [a, b] = [ed.selectionStart, ed.selectionEnd];
    ed.value = n.text;
    ed.setSelectionRange(a, b);
  }
  const tag = TAGS[n.color] !== undefined ? n.color : 'none';
  for (const t of document.querySelectorAll('.tag')) t.classList.toggle('on', t.dataset.tag === tag);
  $('#noteBuddy').value = n.buddy || '';
  const rems = [...n.reminders].sort((a, b) => a.due - b.due);
  $('#detected').innerHTML = rems.length
    ? `<div class="list">${rems.map((r) => remRow(n, r)).join('')}</div>`
    : `<div class="list"><div class="hint">Lines with a time, like “water plants at 6pm”, show up here.</div></div>`;
}

async function flush() {
  if (!dirty || !editingId) return;
  dirty = false;
  clearTimeout(saveTimer);
  await peeky.updateNote(editingId, { text: ed.value });
}
ed.addEventListener('input', () => {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350);
});

async function leaveEditor() {
  await flush();
  const n = note(editingId);
  if (n && !n.text.trim()) peeky.deleteNote(n.id);
  editingId = null;
}

async function newNote() {
  await flush();
  const n = await peeky.createNote();
  S.notes.unshift(n);
  openEditor(n.id);
}

$('#btnNew').addEventListener('click', newNote);
$('#btnBack').addEventListener('click', () => show('notes'));
$('#btnDelete').addEventListener('click', async () => {
  if (!confirm('Delete this note?')) return;
  const id = editingId;
  dirty = false;
  editingId = null;
  await peeky.deleteNote(id);
  show('notes');
});
$('#tags').addEventListener('click', (e) => { const t = e.target.closest('.tag'); if (t) peeky.updateNote(editingId, { color: t.dataset.tag }); });
$('#noteBuddy').addEventListener('change', (e) => peeky.updateNote(editingId, { buddy: e.target.value }));

// Quick chips append a time phrase to the line the caret is on (or start a new to-do).
$('#quick').addEventListener('mousedown', (e) => e.preventDefault());
$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const v = b.dataset.q, text = ed.value, pos = ed.selectionStart;
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  if (v === 'todo') {
    if (text.slice(start, end).trim()) ed.setRangeText('\n[ ] ', end, end, 'end');
    else ed.setRangeText('[ ] ', start, start, 'end');
  } else {
    ed.setRangeText(v, end, end, 'end');
  }
  ed.focus();
  ed.dispatchEvent(new Event('input'));
});

// ---------- reminders (shared by editor + agenda) ----------

function remRow(n, r, withNote = false) {
  const k = buddyKey(n, r);
  const waiting = r.fired && !r.done;
  const status = r.done ? '' : waiting ? ' · Waiting' : ` · ${rel(r.due)}`;
  return `<div class="row rem ${r.done ? 'done' : ''} ${waiting ? 'waiting' : ''}" data-rid="${r.id}">
    <button class="circle" data-act="${r.done ? 'undone' : 'done'}" title="${r.done ? 'Mark as not done' : 'Mark as done'}">${icon('check')}</button>
    <div class="rem-body">
      <div class="rem-text">${esc(r.text)}</div>
      <div class="rem-meta"><span class="when">${fmtWhen(r.due)}</span>${status}${withNote ? ` · ${esc(titleOf(n))}` : ''}</div>
    </div>
    <div class="rem-tools">
      ${r.done ? '' : `<button class="mini" data-act="snooze" title="Remind me 10 minutes later">+10 min</button>`}
      <button class="mini" data-act="test" title="Preview">${icon('play')}</button>
      <img class="face" src="${faces[k] || ''}" title="${esc(BUDDIES[k].name)}" alt="">
    </div>
  </div>`;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.rem [data-act]');
  if (!btn) return;
  await flush();
  peeky.reminder(btn.closest('.rem').dataset.rid, btn.dataset.act, 10);
});

// Today's rows from the connected Google Sheet, with this computer's done/shown state.
function routineToday() {
  const items = (S.routine?.items || []).filter((i) => i.days.includes(new Date().getDay()));
  const d = new Date(), today = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return items.map((i) => {
    const [h, m] = i.time.split(':').map(Number);
    const key = `${i.id}@${today}`;
    return { i, key, due: new Date().setHours(h, m, 0, 0), status: S.routineLog?.[key] };
  });
}

function routineRow({ i, key, due, status }) {
  const k = owns(i.buddy) ? i.buddy : defaultBuddy();
  const done = status === 'done';
  const waiting = status === 'shown';
  return `<div class="row rem ${done ? 'done' : ''} ${waiting ? 'waiting' : ''}" data-rid="routine:${esc(key)}">
    <button class="circle" data-act="${done ? 'undone' : 'done'}" title="${done ? 'Mark as not done' : 'Mark as done'}">${icon('check')}</button>
    <div class="rem-body">
      <div class="rem-text">${esc(i.task)}</div>
      <div class="rem-meta"><span class="when">${timeOf(due)}</span>${done ? '' : waiting ? ' · Waiting' : due < Date.now() ? ' · Missed' : ` · ${rel(due)}`} · Sheet</div>
    </div>
    <div class="rem-tools"><img class="face" src="${faces[k] || ''}" title="${esc(BUDDIES[k].name)}" alt=""></div>
  </div>`;
}

function renderAgenda() {
  const items = allReminders().sort((a, b) => a.r.due - b.r.due);
  const now = Date.now();
  const open = ({ r }) => !r.fired && !r.done;
  const groups = [
    ['Waiting', items.filter(({ r }) => r.fired && !r.done)],
    ['Today', items.filter((x) => open(x) && dayDiff(x.r.due, now) <= 0)],
    ['Tomorrow', items.filter((x) => open(x) && dayDiff(x.r.due, now) === 1)],
    ['Later', items.filter((x) => open(x) && dayDiff(x.r.due, now) > 1)],
    ['Completed', items.filter(({ r }) => r.done).slice(-8).reverse()],
  ].filter(([, list]) => list.length);
  const routine = routineToday();
  const routineHtml = S.routine?.url
    ? `<div class="group-label">Daily Routine<span class="n">${routine.length}</span></div><div class="list">${routine.map(routineRow).join('') || '<div class="hint">Nothing on your sheet for today.</div>'}</div>`
    : `<div class="list"><button class="row row-link routine-cta" id="connectSheet">${icon('sheet')}Connect a Google Sheet routine</button></div>`;
  $('#agenda').innerHTML = routineHtml + (groups.length
    ? groups.map(([title, list]) => `<div class="group-label">${title}<span class="n">${list.length}</span></div><div class="list">${list.map(({ n, r }) => remRow(n, r, true)).join('')}</div>`).join('')
    : `<div class="empty">No note reminders<br>Add a time to any line in a note.</div>`);
  $('#connectSheet')?.addEventListener('click', () => peeky.openWeb('/app#routine'));
}

// ---------- buddy picker (store-aware) ----------

const fmtPrice = (c) => (c ? `$${(c / 100).toFixed(2)}` : 'Free');

function renderBuddy() {
  const k = defaultBuddy();
  const items = S.catalog?.length ? S.catalog.filter((i) => BUDDIES[i.id]) : Object.keys(BUDDIES).map((id) => ({ id, price: 0 }));
  $('#buddyGrid').innerHTML = items.map((i) => {
    const locked = !owns(i.id);
    return `<button class="buddy-card ${locked ? 'locked' : ''} ${i.id === k ? 'on' : ''}" data-buddy="${esc(i.id)}" title="${locked ? `Get ${esc(BUDDIES[i.id].name)} in the store` : `Use ${esc(BUDDIES[i.id].name)}`}">
      ${locked ? `<span class="price">${icon('lock')}${fmtPrice(i.price)}</span>` : ''}
      <img src="${portraits[i.id] || ''}" alt=""><small>${esc(BUDDIES[i.id].name)}</small></button>`;
  }).join('');
  if (!stage) {
    stage = createStage($('#preview'), { distance: 7 });
    stage.setMode('wave');
  }
  stage.setPaused(false);
  stage.setBuddy(k);
  $('#previewName').textContent = BUDDIES[k].name;
  $('#previewKind').textContent = BUDDIES[k].kind;
  $('#optVoice').checked = !!S.settings.voice;
  $('#optChime').checked = !!S.settings.chime;
  $('#optLogin').checked = !!S.settings.openAtLogin;
  $('#acctEmail').textContent = S.account ? `Signed in as ${S.account.user.email}` : '';
}

const hop = () => { stage.setMode('happy'); setTimeout(() => stage.setMode('wave'), 1100); };
$('#buddyGrid').addEventListener('click', (e) => {
  const c = e.target.closest('.buddy-card');
  if (!c) return;
  const k = c.dataset.buddy;
  if (!owns(k)) return peeky.openWeb(`/app#buddies?item=${encodeURIComponent(k)}`);
  S.settings.buddy = k;
  peeky.setSettings({ buddy: k });
  renderBuddy();
  hop();
});
$('#preview').addEventListener('click', hop);
// The preview buddy watches the cursor while it's over the panel.
$('#sheet').addEventListener('mousemove', (e) => {
  if (!stage || view !== 'buddy') return;
  const r = $('#preview').getBoundingClientRect();
  stage.lookAt((e.clientX - (r.left + r.width / 2)) / 160, (r.top + r.height * 0.35 - e.clientY) / 160);
});
$('#sheet').addEventListener('mouseleave', () => stage?.lookAt(null));
$('#btnTest').addEventListener('click', () => peeky.testBuddy(defaultBuddy()));
$('#optVoice').addEventListener('change', (e) => peeky.setSettings({ voice: e.target.checked }));
$('#optChime').addEventListener('change', (e) => peeky.setSettings({ chime: e.target.checked }));
$('#optLogin').addEventListener('change', (e) => peeky.setSettings({ openAtLogin: e.target.checked }));

// ---------- boot ----------

let lastWaiting = 0;
const countWaiting = () => allReminders().filter(({ r }) => r.fired && !r.done).length + routineToday().filter((x) => x.status === 'shown').length;
function adopt(s) {
  S = s;
  registerBuddies(S.catalog || [], S.server || '');
  renderPortraits();
}
peeky.onState((s) => {
  adopt(s);
  const waiting = countWaiting();
  if (waiting > lastWaiting) { $('#pill').classList.remove('ping'); void $('#pill').offsetWidth; $('#pill').classList.add('ping'); }
  lastWaiting = waiting;
  render();
});
adopt(await peeky.getState());
lastWaiting = countWaiting();
render();
setInterval(() => { if (open) render(); else renderBadge(); }, 30e3);
