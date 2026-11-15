import { createStage, BUDDIES, registerBuddies } from './buddies.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const stage = createStage(canvas);
// People and custom models stand tall on the taskbar; the built-in toys stay small.
stage.setFraming({ tall: 0.92, toy: 0.5 });
const SPOT = 0;
const offscreen = () => stage.halfWidth + 1.2;

const queue = [];
let cur = null, busy = false, nags = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function tween(ms, fn) {
  return new Promise((done) => {
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      fn(k);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

async function walk(to, ms) {
  const from = stage.mover.position.x;
  stage.setMode('walk');
  // Flat picture buddies stay facing you; 3D ones turn toward where they're going.
  stage.mover.rotation.y = (to < from ? -1 : 1) * (stage.flat ? 0.12 : 0.9);
  await tween(ms, (k) => { stage.mover.position.x = from + (to - from) * k; });
  const ry = stage.mover.rotation.y;
  await tween(220, (k) => { stage.mover.rotation.y = ry * (1 - k); });
}

// Click-through everywhere except over the card and the buddy.
let ignoring = true;
addEventListener('mousemove', (e) => {
  const hit = !!e.target.closest?.('.hit');
  if (hit === ignoring) { ignoring = !hit; peeky.ignoreMouse(ignoring); }
});

// The buddy watches the cursor anywhere on screen.
peeky.onCursor(({ x, y }) => {
  const r = canvas.getBoundingClientRect();
  const headX = r.left + r.width / 2 + (stage.mover.position.x / stage.halfWidth) * (r.width / 2);
  const headY = r.top + r.height * 0.25;
  stage.lookAt((x - headX) / 350, (headY - y) / 300);
});

function speak(text, voice) {
  speechSynthesis.cancel();
  if (!cur?.settings.voice) {
    stage.setTalking(true);
    setTimeout(() => stage.setTalking(false), Math.min(3500, text.length * 55));
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.pitch = voice.pitch;
  u.rate = voice.rate;
  u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('en')) || null;
  u.onstart = () => stage.setTalking(true);
  u.onend = u.onerror = () => stage.setTalking(false);
  speechSynthesis.speak(u);
}

// A soft two-note glass chime.
function chime(notes = [1046.5, 1568]) {
  if (!cur?.settings.chime) return;
  try {
    const ac = new AudioContext();
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.11;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + 1);
    });
    setTimeout(() => ac.close(), 1800);
  } catch {}
}

// What the card says and which replies it offers, per kind of reminder.
function cardFor(p, b) {
  const tasks = [['yes', 'Done', 'done'], ['', '5 min', 'snooze', 5], ['', '15 min', 'snooze', 15]];
  switch (p.kind) {
    case 'test':
      return { tag: 'Preview', title: `Hi, I'm ${b.name}`, body: `When something is due I'll walk in right here — like: ${p.text}.`,
        say: `Hi! I'm ${b.name}. When something is due, I'll walk in right here.`, actions: [['yes', 'Nice', 'dismiss']] };
    case 'nudge':
      return { tag: p.tag, title: p.text, body: p.body || '', say: p.text, actions: [['yes', 'Yes', 'done'], ['', 'Later', 'snooze', 10]],
        doneLine: pick(['Nice.', 'Good call.', 'Proud of you.']) };
    case 'focus':
      return { tag: 'Focus', title: 'Focus session complete', body: `${p.minutes} minutes of deep work. Take a short break.`,
        say: 'Focus session complete. Take a short break.', actions: [['yes', 'Take a break', 'done'], ['', 'Go again', 'again']],
        doneLine: 'Enjoy the break.' };
    case 'routine':
      return { tag: 'Routine', title: cap(p.text), body: `${b.hello} It's time.`, note: 'From your daily routine', say: `${b.hello} It's time to ${p.text}!`, actions: tasks };
    default:
      return { tag: 'Reminder', title: cap(p.text), body: `${b.hello} It's time.`, note: p.noteTitle ? `From “${p.noteTitle}”` : '',
        say: `${b.hello} It's time to ${p.text}!`, actions: tasks };
  }
}

function fill({ title, body = '', note = '' }) {
  $('title').textContent = title;
  $('body').textContent = body;
  $('note').textContent = note;
}

const renderQueue = () => { $('more').textContent = queue.length ? `${queue.length} more after this` : ''; };

function confetti() {
  const colors = ['#c6ff34', '#2b59ff', '#f3f5f9'];
  for (let i = 0; i < 30; i++) {
    const el = document.createElement('i');
    el.className = 'bit';
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
    el.style.cssText = `background:${pick(colors)};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 50}px`;
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
}

function zzz() {
  for (let i = 0; i < 3; i++) setTimeout(() => {
    const el = document.createElement('span');
    el.className = 'zzz';
    el.textContent = 'z';
    $('fx').appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }, i * 330);
}

function clearNags() {
  nags.forEach(clearTimeout);
  nags = [];
}

// If a task is ignored, the buddy gets more insistent. Gentle nudges never nag.
function scheduleNags(b) {
  if (cur.kind === 'nudge' || cur.kind === 'test' || cur.kind === 'focus') return;
  const lines = [
    [45e3, `Psst… still waiting on you to ${cur.text}.`],
    [120e3, `Hey! ${cur.text}! Don't make me come back.`],
  ];
  for (const [ms, line] of lines) nags.push(setTimeout(() => {
    if (busy) return;
    stage.setMode('nag');
    chime([1568, 1046.5, 1568]);
    const card = $('card');
    card.classList.remove('nudge');
    void card.offsetWidth;
    card.classList.add('nudge');
    speak(line, b.voice);
    setTimeout(() => !busy && stage.setMode('wave'), 2400);
  }, ms));
}

async function next() {
  cur = queue.shift();
  renderQueue();
  if (!cur) {
    await sleep(150);
    if (!queue.length) peeky.buddyClosed();
    return;
  }
  registerBuddies(cur.catalog || [], cur.server || '');
  const key = BUDDIES[cur.buddy] ? cur.buddy : 'robot';
  const b = BUDDIES[key];
  await stage.setBuddy(key);
  stage.mover.position.x = offscreen();
  chime();
  await walk(SPOT, 1200);
  stage.setMode('wave');

  const c = cardFor(cur, b);
  cur.card = c;
  $('who').textContent = b.name;
  $('tag').textContent = c.tag;
  $('when').textContent = cur.kind === 'test' ? '' : clock(cur.due);
  fill(c);
  $('actions').innerHTML = c.actions.map(([cls, label, act, min]) => `<button class="${cls}" data-act="${act}" data-min="${min || 0}">${label}</button>`).join('');
  speak(c.say, b.voice);
  $('card').classList.remove('hidden', 'out', 'nudge');
  scheduleNags(b);
}

async function act(action, minutes) {
  if (busy || !cur) return;
  busy = true;
  clearNags();
  const b = BUDDIES[stage.buddy];
  if (cur.kind !== 'test' && ['done', 'snooze', 'again'].includes(action)) peeky.reminder(cur.id, action, minutes);
  if (action === 'done') {
    stage.setMode('happy');
    confetti();
    chime([1318.5, 1568, 2093]);
    const line = cur.card.doneLine || pick(['Nice work!', 'Nailed it!', 'You did it!', 'Look at you go!']);
    fill({ title: line, body: cur.kind === 'reminder' ? 'Checked off in your note.' : '' });
    $('actions').innerHTML = '';
    speak(line, b.voice);
    await sleep(1500);
  } else if (action === 'snooze') {
    stage.setMode('sleep');
    zzz();
    fill({ title: `See you in ${minutes} minutes`, body: "I'll check back with you." });
    $('actions').innerHTML = '';
    speak(`Okay. Back in ${minutes} minutes.`, b.voice);
    await sleep(1500);
  } else if (action === 'again') {
    fill({ title: 'Another round. Go!', body: `${cur.minutes} more minutes of focus.` });
    $('actions').innerHTML = '';
    await sleep(1200);
  } else {
    speechSynthesis.cancel();
  }
  $('card').classList.add('out');
  stage.setTalking(false);
  await sleep(200);
  $('card').classList.add('hidden');
  await walk(offscreen(), 950);
  busy = false;
  next();
}

$('card').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (btn) act(btn.dataset.act, +btn.dataset.min || 0);
});

// Poke the buddy and it hops.
canvas.addEventListener('click', () => {
  if (busy || !cur) return;
  stage.setMode('happy');
  setTimeout(() => !busy && stage.setMode('wave'), 900);
});

peeky.onBuddy((r) => {
  queue.push(r);
  renderQueue();
  if (!cur && !busy) next();
});
peeky.buddyReady();
