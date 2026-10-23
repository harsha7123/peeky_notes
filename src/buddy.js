import { createStage, BUDDIES, registerBuddies } from './buddies.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const stage = createStage(canvas);
const OFF = 2.1, SPOT = 0; // x positions: offscreen right, standing spot
const HALF_W = 1.26;       // half the visible world width at the buddy's depth
stage.mover.position.x = OFF;

const queue = [];
const avatars = {};
let cur = null, busy = false, nags = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

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
  stage.mover.rotation.y = to < from ? -0.9 : 0.9;
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
  const headX = r.left + r.width / 2 + (stage.mover.position.x / HALF_W) * (r.width / 2);
  const headY = r.top + r.height * 0.32;
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

async function avatar(key) {
  if (!avatars[key]) {
    const c = document.createElement('canvas');
    const s = createStage(c, { size: [64, 64], distance: 3.4, target: 1.35 });
    avatars[key] = await s.snapshot(key);
    s.dispose();
  }
  return avatars[key];
}

function fill({ title, body = '', note = '' }) {
  $('title').textContent = title;
  $('body').textContent = body;
  $('note').textContent = note;
}

const renderQueue = () => { $('more').textContent = queue.length ? `${queue.length} more after this` : ''; };

function confetti() {
  const colors = ['#ff3b30', '#ff9f0a', '#ffcc00', '#34c759', '#007aff', '#af52de'];
  for (let i = 0; i < 28; i++) {
    const el = document.createElement('i');
    el.className = 'bit';
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
    el.style.cssText = `background:${pick(colors)};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px`;
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

// If ignored, the buddy gets more insistent.
function scheduleNags(b) {
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
  stage.mover.position.x = OFF;
  chime();
  await walk(SPOT, 1100);
  stage.setMode('wave');

  avatar(key).then((src) => { $('avatar').src = src; });
  $('app').textContent = `${b.name} · Peeky`;
  $('when').textContent = cur.test ? 'Preview' : clock(cur.due);
  if (cur.test) {
    fill({ title: `Hi, I'm ${b.name}`, body: `When a to-do in your notes is due, I'll walk in right here — for example: ${cur.text}.` });
    speak(`Hi! I'm ${b.name}. When a to-do is due, I'll pop up right here and remind you.`, b.voice);
  } else {
    fill({ title: cur.text.charAt(0).toUpperCase() + cur.text.slice(1), body: `${b.hello} It's time.`, note: cur.noteTitle ? `From “${cur.noteTitle}”` : '' });
    speak(`${b.hello} It's time to ${cur.text}!`, b.voice);
  }
  $('card').classList.remove('hidden', 'out', 'nudge');
  scheduleNags(b);
}

async function act(action, minutes) {
  if (busy || !cur) return;
  busy = true;
  clearNags();
  const b = BUDDIES[stage.buddy];
  if (!cur.test && action !== 'dismiss') peeky.reminder(cur.id, action, minutes);
  if (action === 'done') {
    stage.setMode('happy');
    confetti();
    chime([1318.5, 1568, 2093]);
    const line = pick(['Nice work!', 'Nailed it!', 'You did it!', 'Look at you go!']);
    fill({ title: line, body: 'Checked off in your note.' });
    speak(line, b.voice);
    await sleep(1600);
  } else if (action === 'snooze') {
    stage.setMode('sleep');
    zzz();
    fill({ title: `See you in ${minutes} minutes`, body: "I'll take a quick nap and come back." });
    speak(`Okay. Back in ${minutes} minutes.`, b.voice);
    await sleep(1600);
  } else {
    speechSynthesis.cancel();
  }
  $('card').classList.add('out');
  stage.setTalking(false);
  await sleep(200);
  $('card').classList.add('hidden');
  await walk(OFF, 900);
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
