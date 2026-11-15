import { createStage, BUDDIES, registerBuddies } from '/shared/buddies.js';
import { api, esc, icon, price, toast, portraits, $ } from './common.js';

const ROUTES = [
  ['notes', 'Notes', 'note'],
  ['routine', 'Routine', 'routine'],
  ['buddies', 'Buddies', 'buddy'],
  ['devices', 'Devices', 'devices'],
  ['account', 'Account', 'account'],
];
const TAGS = { none: '', cobalt: '#2b59ff', lime: '#c6ff34', white: '#f3f5f9', red: '#ff5a5a' };
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const PREFIX = /^\s*(?:[-*•]\s*)?(?:\[[ xX]\]\s*)?/;

let me, catalog, pics = {};
let notes = [], selected = null, search = '', saveTimer = 0;
let stage = null;
const view = $('#view');

function renderChrome() {
  const initials = me.user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  $('#avatar').textContent = $('#avatarSm').textContent = initials;
  $('#meName').textContent = me.user.name;
  $('#meEmail').textContent = me.user.email;
  $('#sideNav').innerHTML = ROUTES.map(([id, label, ico]) => `<a class="nav-item" href="#${id}" data-r="${id}">${icon(ico)}${label}</a>`).join('');
  $('#tabbar').innerHTML = ROUTES.map(([id, label, ico]) => `<a href="#${id}" data-r="${id}">${icon(ico)}${label}</a>`).join('');
  $('#avatarSm').addEventListener('click', () => { location.hash = 'account'; });
}

function route() {
  const id = (location.hash.slice(1) || 'notes').split('?')[0];
  const r = ROUTES.find(([k]) => k === id) || ROUTES[0];
  for (const a of document.querySelectorAll('[data-r]')) a.classList.toggle('on', a.dataset.r === r[0]);
  document.title = `${r[1]} — Peeky`;
  stage?.dispose();
  stage = null;
  ({ notes: viewNotes, routine: viewRoutine, buddies: viewBuddies, devices: viewDevices, account: viewAccount })[r[0]]();
  scrollTo(0, 0);
}

const head = (title, sub, action = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${action}</div>`;
const face = (k, size = 22) => `<img data-face="${esc(k)}" src="${pics[k] || ''}" alt="" width="${size}" height="${size}" style="border-radius:50%;background:var(--fill)">`;
const timeLabel = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
function when(ms) {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (diff === 0) return `Today, ${t}`;
  if (diff === 1) return `Tomorrow, ${t}`;
  if (diff === -1) return `Yesterday, ${t}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
}
const owned = (k) => catalog.items.find((i) => i.id === k)?.owned;

// ---------- notes ----------

const titleOf = (n) => (n.text.split('\n').find((l) => l.trim()) || '').replace(PREFIX, '').slice(0, 80) || 'New Note';

async function viewNotes() {
  view.innerHTML = head('Notes', 'Synced with Peeky on your computers. Add a time to any line to get a reminder.',
    `<button class="btn sm" id="newNote">${icon('plus')}New Note</button>`) + `
    <div class="notes" id="notesWrap">
      <div class="note-col">
        <label class="search">${icon('search')}<input id="q" placeholder="Search" value="${esc(search)}"></label>
        <div id="noteList"></div>
      </div>
      <div class="editor-col" id="editorCol"></div>
    </div>`;
  $('#newNote').addEventListener('click', newNote);
  $('#q').addEventListener('input', (e) => { search = e.target.value; renderList(); });
  ({ notes } = await api('/api/notes'));
  notes = notes.filter((n) => !n.deleted);
  if (!selected && notes.length && matchMedia('(min-width: 1021px)').matches) selected = notes[0].id;
  renderList();
  renderEditor();
}

function renderList() {
  const q = search.toLowerCase();
  const list = notes.filter((n) => !q || n.text.toLowerCase().includes(q)).sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  $('#noteList').innerHTML = list.length
    ? `<div class="list note-list">${list.map((n) => {
      const rest = n.text.split('\n').filter((l) => l.trim()).slice(1).map((l) => l.replace(PREFIX, '')).join(' ');
      const d = new Date(n.updated);
      const stamp = d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<div class="row ${n.id === selected ? 'on' : ''}" data-id="${esc(n.id)}"><div class="t">${n.pinned ? '📌 ' : ''}${esc(titleOf(n))}</div><div class="s"><b>${stamp}</b>${esc(rest) || 'No additional text'}</div></div>`;
    }).join('')}</div>`
    : `<div class="card empty"><div class="h3">${q ? 'No Results' : 'No Notes'}</div>${q ? '' : 'Create your first note to get started.'}</div>`;
  for (const row of document.querySelectorAll('.note-list .row')) row.addEventListener('click', () => { selected = row.dataset.id; renderList(); renderEditor(); });
}

function renderEditor() {
  const n = notes.find((x) => x.id === selected);
  $('#notesWrap').classList.toggle('editing', !!n);
  if (!n) { $('#editorCol').innerHTML = `<div class="card empty"><div class="h3">No note selected</div>Pick a note or create a new one.</div>`; return; }
  const ownedBuddies = catalog.items.filter((i) => i.owned);
  $('#editorCol').innerHTML = `
    <div class="card editor-card">
      <div class="editor-tools">
        <button class="btn ghost back-link" id="back">${icon('back')}Notes</button>
        <div class="tagdots">${Object.entries(TAGS).map(([k, c]) => `<i class="${k === 'none' ? 'none' : ''} ${(n.color || 'none') === k ? 'on' : ''}" data-tag="${k}" title="${k}" style="${c ? `background:${c}` : ''}"></i>`).join('')}</div>
        <select class="select" id="nb" aria-label="Buddy for this note"><option value="">Default buddy</option>${ownedBuddies.map((b) => `<option value="${esc(b.id)}" ${n.buddy === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <span class="grow"></span>
        <span class="saved" id="saved">Saved</span>
        <button class="btn sm gray" id="pin">${n.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn sm danger" id="del" aria-label="Delete note">${icon('trash')}</button>
      </div>
      <textarea id="noteText" spellcheck="true" placeholder="Start typing…&#10;&#10;[ ] Call mom at 5pm&#10;[ ] Stretch in 20 min #cat">${esc(n.text)}</textarea>
    </div>
    <div class="group-title">Reminders</div>
    <div id="rems"></div>`;
  renderReminders(n);
  const ta = $('#noteText');
  ta.addEventListener('input', () => { n.text = ta.value; queueSave(n); });
  $('#back').addEventListener('click', () => { selected = null; renderList(); renderEditor(); });
  $('#nb').addEventListener('change', (e) => { n.buddy = e.target.value; queueSave(n, 0); });
  $('#pin').addEventListener('click', () => { n.pinned = !n.pinned; queueSave(n, 0); renderEditor(); renderList(); });
  for (const t of document.querySelectorAll('[data-tag]')) t.addEventListener('click', () => { n.color = t.dataset.tag; queueSave(n, 0); renderEditor(); });
  $('#del').addEventListener('click', async () => {
    if (!confirm('Delete this note? It will also be removed from your computers.')) return;
    await api(`/api/notes/${encodeURIComponent(n.id)}`, { method: 'PUT', body: { ...n, deleted: true, updated: Date.now() } });
    notes = notes.filter((x) => x.id !== n.id);
    selected = null;
    renderList();
    renderEditor();
  });
}

function renderReminders(n) {
  const rems = [...(n.reminders || [])].sort((a, b) => a.due - b.due);
  $('#rems').innerHTML = rems.length
    ? `<div class="list">${rems.map((r) => `<div class="row rem ${r.done ? 'done' : ''}"><span class="c"></span><div style="flex:1;min-width:0"><div class="rt">${esc(r.text)}</div><div class="rm">${when(r.due)}${r.fired && !r.done ? ' · Shown' : ''}</div></div>${face(r.buddy || n.buddy || me.settings.buddy)}</div>`).join('')}</div>`
    : `<div class="list"><div class="row sub small">Lines with a time — like “water plants at 6pm” or “in 20 min” — become reminders here.</div></div>`;
}

function queueSave(n, delay = 700) {
  $('#saved') && ($('#saved').textContent = 'Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    n.updated = Date.now();
    try {
      const { note } = await api(`/api/notes/${encodeURIComponent(n.id)}`, { method: 'PUT', body: { text: n.text, color: n.color, buddy: n.buddy, pinned: n.pinned, updated: n.updated, created: n.created } });
      Object.assign(n, note);
      if (selected === n.id) { renderReminders(n); $('#saved').textContent = 'Saved'; }
      renderList();
    } catch (e) {
      if (e.status === 409) { Object.assign(n, e.data.note); renderEditor(); toast('This note changed on another device — showing the latest version.'); }
      else toast(e.message);
    }
  }, delay);
}

function newNote() {
  const n = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: '', color: 'none', buddy: '', pinned: false, created: Date.now(), updated: Date.now(), reminders: [] };
  notes.unshift(n);
  selected = n.id;
  search = '';
  renderList();
  renderEditor();
  $('#noteText').focus();
}

// ---------- routine (Google Sheets) ----------

async function viewRoutine() {
  view.innerHTML = head('Daily Routine', 'Connect a Google Sheet. Each row with a time becomes a reminder from your buddy.');
  const r = await api('/api/routine');
  r.url ? renderRoutine(r) : renderSetup();
}

function renderSetup(error = '') {
  view.insertAdjacentHTML('beforeend', `
    <div class="card setup">
      <h2 class="h3">Connect your routine</h2>
      <ol>
        <li><b>Create a Google Sheet</b> with the columns <code class="k">Time</code> <code class="k">Task</code> <code class="k">Days</code> <code class="k">Buddy</code>. <a href="#" id="tpl">Download a template</a> and import it with File → Import.</li>
        <li>Click <b>Share</b>, then under General access choose <b>Anyone with the link</b> (Viewer).</li>
        <li><b>Copy the link</b> and paste it below.</li>
      </ol>
      <form class="inline-form" id="connect">
        <input class="field" id="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" required>
        <button class="btn" type="submit">Connect</button>
      </form>
      <div class="error" id="err">${esc(error)}</div>
      <p class="small sub" style="margin:4px 0 0">Days can be <b>Daily</b>, <b>Weekdays</b>, <b>Weekends</b>, or days like <b>Mon, Wed, Fri</b>. Times like 7:30 AM or 19:00 both work.</p>
    </div>`);
  $('#tpl').addEventListener('click', (e) => {
    e.preventDefault();
    const csv = 'Time,Task,Days,Buddy\n7:00 AM,Drink a glass of water,Daily,cat\n9:30 AM,Team standup,Weekdays,robot\n1:00 PM,Stretch break,Daily,\n6:30 PM,Gym,"Mon, Wed, Fri",\n10:30 PM,Screens off,Daily,\n';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'peeky-routine-template.csv' });
    a.click();
  });
  $('#connect').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try {
      await api('/api/routine', { method: 'POST', body: { url: $('#url').value } });
      toast('Routine connected');
      viewRoutine();
    } catch (err) {
      $('#err').textContent = err.message;
      btn.disabled = false;
    }
  });
}

function renderRoutine(r) {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const today = r.items.filter((i) => i.days.includes(new Date().getDay()));
  const nextIdx = today.findIndex((i) => { const [h, m] = i.time.split(':').map(Number); return h * 60 + m >= nowMin; });
  const ago = r.synced ? Math.max(0, Math.round((Date.now() - r.synced) / 6e4)) : null;
  view.insertAdjacentHTML('beforeend', `
    <div class="card status">
      <div class="file-ico">${icon('sheet')}</div>
      <div class="grow"><b>Google Sheet connected</b><div class="small sub">${r.items.length} reminders · ${ago === null ? 'never synced' : ago < 1 ? 'synced just now' : `synced ${ago} min ago`} · syncs every 15 minutes</div>
        ${r.error ? `<div class="error" style="margin:4px 0 0">${esc(r.error)}</div>` : ''}</div>
      <a class="btn sm gray" href="${esc(r.url)}" target="_blank" rel="noopener">Open Sheet</a>
      <button class="btn sm gray" id="sync">${icon('sync')}Sync Now</button>
      <button class="btn sm danger" id="disc">Disconnect</button>
    </div>
    <div class="two" style="margin-top:20px">
      <div><div class="group-title">Today</div>
        <div class="card timeline">${today.length ? today.map((i, k) => `
          <div class="tl ${nextIdx === -1 || k < nextIdx ? 'past' : k === nextIdx ? 'now' : ''}">
            <div class="tm">${timeLabel(i.time)}</div><div class="dot"></div>
            <div class="tk">${esc(i.task)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</div>
          </div>`).join('') : '<div class="empty">Nothing scheduled today.</div>'}
        </div></div>
      <div><div class="group-title">Every day</div>
        <div class="list">${r.items.map((i) => `
          <div class="row"><div style="width:74px" class="small sub">${timeLabel(i.time)}</div>
            <div style="flex:1;min-width:0"><div>${esc(i.task)}</div><div class="days">${DAY_LETTERS.map((d, k) => `<i class="${i.days.includes(k) ? 'on' : ''}">${d}</i>`).join('')}</div></div>
            ${face(BUDDIES[i.buddy] && owned(i.buddy) ? i.buddy : me.settings.buddy)}</div>`).join('') || '<div class="row sub">Your sheet has no rows with a Time and a Task yet.</div>'}
        </div></div>
    </div>`);
  $('#sync').addEventListener('click', async () => {
    try { await api('/api/routine/sync', { method: 'POST' }); toast('Routine synced'); } catch (e) { toast(e.message); }
    viewRoutine();
  });
  $('#disc').addEventListener('click', async () => {
    if (!confirm('Disconnect this Google Sheet? Its reminders will stop.')) return;
    await api('/api/routine', { method: 'DELETE' });
    viewRoutine();
  });
}

// ---------- buddies (store) ----------

async function viewBuddies() {
  catalog = await api('/api/catalog');
  registerBuddies(catalog.items);
  me = await api('/api/me');
  let focus = location.hash.split('?item=')[1] || me.settings.buddy;
  if (!catalog.items.some((i) => i.id === focus)) focus = me.settings.buddy;
  view.innerHTML = head('Buddies', 'Choose who reminds you. Your default buddy appears on all your computers.') + `
    <div class="stage" id="stageWrap"><canvas id="bstage"></canvas>
      <div class="info"><div class="h3" id="bName"></div><p id="bBlurb"></p><div id="bAction"></div></div></div>
    <div class="buddy-grid" id="bgrid"></div>
    ${catalog.bundle.owned || catalog.store === 'closed' ? '' : `<div class="card bundle"><div class="grow"><b>${esc(catalog.bundle.name)}</b><div class="small sub">${esc(catalog.bundle.blurb)}</div></div><button class="btn" data-buy="${esc(catalog.bundle.id)}">Get all for ${price(catalog.bundle.price)}</button></div>`}
    <div class="group-title">Reminder style</div>
    <div class="list">
      <label class="row">Speak reminders aloud<input type="checkbox" class="switch" id="sVoice" ${me.settings.voice ? 'checked' : ''}></label>
      <label class="row">Play a sound<input type="checkbox" class="switch" id="sChime" ${me.settings.chime ? 'checked' : ''}></label>
    </div>
    ${catalog.testMode ? '<p class="notice">Store is in test mode — purchases unlock instantly and nothing is charged.</p>' : ''}
    ${catalog.store === 'closed' ? '<p class="notice">The buddy store opens soon. Free buddies are ready to use now.</p>' : ''}
    ${catalog.store === 'live' ? '<p class="notice">Secure checkout by Stripe. Purchases unlock on all your computers.</p>' : ''}`;
  const purchased = location.hash.split('purchased=')[1];
  if (purchased) {
    toast('Thanks! Your buddy is unlocked.');
    history.replaceState(null, '', '#buddies');
  }

  stage = createStage($('#bstage'), { distance: 6.6 });
  stage.setMode('wave');
  const wrap = $('#stageWrap');
  wrap.addEventListener('pointermove', (e) => {
    const r = wrap.getBoundingClientRect();
    stage?.lookAt((e.clientX - (r.left + r.width / 2)) / 300, (r.top + r.height * 0.35 - e.clientY) / 250);
  });
  wrap.addEventListener('pointerleave', () => stage?.lookAt(null));

  const show = async (k) => {
    focus = k;
    const item = catalog.items.find((i) => i.id === k);
    $('#bName').textContent = item.image ? item.name : `${item.name} the ${item.kind}`;
    $('#bBlurb').textContent = item.blurb || '';
    $('#bAction').innerHTML = !item.owned
      ? catalog.store === 'closed' ? `<span class="pill-tag">${price(item.price)} · Coming soon</span>` : `<button class="btn" data-buy="${esc(k)}">Get for ${price(item.price)}</button>`
      : me.settings.buddy === k ? '<span class="pill-tag ok">✓ Your buddy</span>'
      : `<button class="btn gray" id="setDefault">Make my buddy</button>`;
    $('#setDefault')?.addEventListener('click', async () => {
      const { settings } = await api('/api/settings', { method: 'PATCH', body: { buddy: k } });
      me.settings = settings;
      toast(`${item.name} is now your buddy`);
      show(k);
      grid();
    });
    for (const c of document.querySelectorAll('.bcard')) c.classList.toggle('on', c.dataset.id === k);
    await stage?.setBuddy(k);
    stage?.setMode('happy');
    setTimeout(() => stage?.setMode('wave'), 1100);
  };
  const grid = () => {
    $('#bgrid').innerHTML = catalog.items.map((i) => `
      <div class="card bcard ${i.id === focus ? 'on' : ''}" data-id="${esc(i.id)}" tabindex="0">
        ${i.owned ? (me.settings.buddy === i.id ? '<span class="pill-tag ok">Default</span>' : '') : `<span class="pill-tag">${price(i.price)}</span>`}
        <img data-face="${esc(i.id)}" src="${pics[i.id] || ''}" alt=""><b>${esc(i.name)}</b><small>${esc(i.kind)}</small></div>`).join('');
    for (const c of document.querySelectorAll('.bcard')) {
      c.addEventListener('click', () => show(c.dataset.id));
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter') show(c.dataset.id); });
    }
  };
  grid();
  show(focus);

  view.onclick = async (e) => {
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    b.disabled = true;
    try {
      const res = await api('/api/store/checkout', { method: 'POST', body: { item: b.dataset.buy } });
      if (res.url) { location.href = res.url; return; }
      toast(res.testMode ? 'Unlocked (test mode — no charge)' : 'Unlocked');
      viewBuddies();
    } catch (err) {
      toast(err.message);
      b.disabled = false;
    }
  };
  $('#sVoice').addEventListener('change', (e) => api('/api/settings', { method: 'PATCH', body: { voice: e.target.checked } }));
  $('#sChime').addEventListener('change', (e) => api('/api/settings', { method: 'PATCH', body: { chime: e.target.checked } }));
}

// ---------- devices ----------

async function viewDevices() {
  view.innerHTML = head('Devices', 'Peeky reminds you on your computer. Link as many as you like.') + `
    <div class="card device-hero">
      <div class="laptop"></div>
      <div class="grow"><h2 class="h3">Peeky for Windows</h2>
        <p class="sub small" style="margin:6px 0 0">Install the app, then click <b>Sign in with browser</b>. You'll be sent here to approve it.</p></div>
      <a class="btn hidden" id="dlBtn" href="/download/windows">Download</a>
      <span class="pill-tag hidden" id="dlSoon">Coming soon</span>
    </div>
    <div class="group-title">Have a code?</div>
    <div class="card setup" style="padding:20px">
      <form class="inline-form" id="codeForm"><input class="field" id="code" placeholder="ABCD-1234" autocomplete="off" style="text-transform:uppercase;font-family:var(--mono);letter-spacing:.1em"><button class="btn">Continue</button></form>
    </div>
    <div class="group-title">Signed-in computers</div>
    <div class="list" id="devs"><div class="row sub">Loading…</div></div>`;
  api('/api/download').then(({ windows }) => $(windows ? '#dlBtn' : '#dlSoon').classList.remove('hidden'));
  $('#codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#code').value.trim().toUpperCase();
    if (code) location.href = `/link?code=${encodeURIComponent(code)}`;
  });
  const load = async () => {
    const { devices } = await api('/api/devices');
    $('#devs').innerHTML = devices.length ? devices.map((d) => `
      <div class="row">${icon('devices')}<div style="flex:1"><div>${esc(d.label || 'Computer')}</div><div class="small sub">Last active ${when(d.lastSeen)}</div></div>
      <button class="btn sm danger" data-dev="${esc(d.id)}">Sign Out</button></div>`).join('') : '<div class="row sub">No computers yet.</div>';
    for (const b of document.querySelectorAll('[data-dev]')) b.addEventListener('click', async () => { await api(`/api/devices/${b.dataset.dev}`, { method: 'DELETE' }); load(); });
  };
  load();
}

// ---------- account ----------

function viewAccount() {
  view.innerHTML = head('Account') + `
    <div class="list">
      <div class="row"><span class="sub" style="width:90px">Name</span><input class="field" id="nm" value="${esc(me.user.name)}" style="height:40px;flex:1"><button class="btn sm gray" id="saveName">Save</button></div>
      <div class="row"><span class="sub" style="width:90px">Email</span><span>${esc(me.user.email)}</span></div>
      <div class="row"><span class="sub" style="width:90px">Member since</span><span>${new Date(me.user.created).toLocaleDateString([], { month: 'long', year: 'numeric' })}</span></div>
    </div>
    <div class="group-title">Purchases</div>
    <div class="list">${catalog.items.filter((i) => i.price && i.owned).map((i) => `<div class="row">${face(i.id, 28)}<span style="flex:1">${esc(i.name)} the ${esc(i.kind)}</span><span class="pill-tag ok">Owned</span></div>`).join('') || '<div class="row sub">No purchases yet.</div>'}</div>
    <div class="group-title"></div>
    <div class="list"><button class="row" id="signout" style="color:var(--red)">Sign Out</button></div>
    <div class="group-title"></div>
    <div class="list"><button class="row" id="delAcct" style="color:var(--red)">Delete Account…</button></div>
    <p class="small sub" style="margin:10px 4px">Deleting your account permanently removes your notes, routine, linked computers and purchases.
      <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>`;
  $('#delAcct').addEventListener('click', async () => {
    const password = prompt('This permanently deletes your Peeky account and everything in it.\n\nEnter your password to confirm:');
    if (!password) return;
    try {
      await api('/api/me', { method: 'DELETE', body: { password } });
      location.href = '/';
    } catch (e) { toast(e.message); }
  });
  $('#saveName').addEventListener('click', async () => {
    ({ user: me.user } = await api('/api/me', { method: 'PATCH', body: { name: $('#nm').value } }));
    renderChrome();
    route();
    toast('Saved');
  });
  $('#signout').addEventListener('click', async () => {
    await api('/api/auth/signout', { method: 'POST' });
    location.href = '/';
  });
}

// ---------- boot (last, so every helper above is initialized) ----------

try {
  me = await api('/api/me');
} catch {
  location.replace(`/signin?next=${encodeURIComponent('/app' + location.hash)}`);
  throw new Error('signed out');
}
catalog = await api('/api/catalog');
registerBuddies(catalog.items);
renderChrome();
addEventListener('hashchange', route);
route();
portraits(createStage, catalog.items.map((i) => i.id).filter((k) => BUDDIES[k])).then((p) => {
  pics = p;
  for (const img of document.querySelectorAll('img[data-face]')) img.src = pics[img.dataset.face] || '';
});
