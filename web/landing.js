import { createStage, BUDDIES, registerBuddies } from '/shared/buddies.js';
import { api, esc, price, portraits, $ } from './common.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(pointer: fine)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function tween(ms, fn) {
  return new Promise((done) => {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      fn(k);
      if (k < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}

function confettiAt(el) {
  if (reduced) return;
  const r = el.getBoundingClientRect();
  const colors = ['#c6ff34', '#2b59ff', '#f3f5f9'];
  for (let i = 0; i < 34; i++) {
    const p = document.createElement('i');
    const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 130;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${pick(colors)};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 60}px`;
    $('#confetti').appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

// ---------- nav ----------

const nav = $('#lnav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
api('/api/session').then(({ user }) => {
  if (user) { $('#navCta').href = '/app'; $('#navCta span').textContent = 'Open Peeky'; }
}).catch(() => {});

// ---------- hero: live buddy with a reminder card ----------

const heroCanvas = $('#heroStage');
const heroStage = createStage(heroCanvas, { distance: 6.4 });
heroStage.setFraming({ toy: 0.6, tall: 0.88 });
heroStage.setBuddy('robot').then(() => heroStage.setMode('wave'));
addEventListener('pointermove', (e) => {
  const r = heroCanvas.getBoundingClientRect();
  heroStage.lookAt((e.clientX - (r.left + r.width / 2)) / 520, (r.top + r.height * 0.35 - e.clientY) / 420);
});
heroCanvas.addEventListener('click', () => { heroStage.setMode('happy'); setTimeout(() => heroStage.setMode('wave'), 1100); });

const HERO_LINES = [
  ['Water break', 'Time for a glass of water.'],
  ['Stretch', 'Stand up and stretch for a minute.'],
  ['Reminder', 'Call mom — it\'s 5:00 PM.'],
  ['Eye break', 'Look far away for 20 seconds.'],
  ['Focus', 'Focus session done. Take a break.'],
];
let heroIdx = 0, heroBusy = false;
function showHeroLine() {
  const [t, title] = HERO_LINES[heroIdx % HERO_LINES.length];
  $('#hcTag').textContent = t;
  $('#hcTitle').textContent = title;
  $('#hcActions').classList.remove('hidden');
  const card = $('#heroCard');
  card.classList.add('swap');
  void card.offsetWidth;
  card.classList.remove('swap');
}
$('#heroCard').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-hc]');
  if (!b || heroBusy) return;
  heroBusy = true;
  $('#hcActions').classList.add('hidden');
  if (b.dataset.hc === 'yes') {
    heroStage.setMode('happy');
    confettiAt(b);
    $('#hcTitle').textContent = pick(['Nice.', 'Nailed it.', 'Proud of you.']);
  } else {
    heroStage.setMode('sleep');
    $('#hcTitle').textContent = 'Okay — back in 10 minutes.';
  }
  await sleep(1800);
  heroStage.setMode('wave');
  heroIdx++;
  showHeroLine();
  heroBusy = false;
});

// ---------- marquee ----------

const TICKER = [
  ['Drink water', '3:00 PM'], ['Call mom', '5:00 PM'], ['Stretch', 'in 20 min'], ['Standup', 'tomorrow 9:30'],
  ['Pay rent', 'Friday'], ['Gym', 'Mon · Wed · Fri'], ['Screens off', '10:30 PM'], ['Water the plants', 'every evening'],
];
const tickerHtml = TICKER.map(([t, w]) => `<span>${esc(t)} <small>${esc(w)}</small></span>`).join('');
$('#marquee').innerHTML = tickerHtml + tickerHtml;

// ---------- scroll reveals + tilt ----------

const io = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 60}ms`;
  io.observe(el);
});

if (finePointer && !reduced) {
  for (const el of document.querySelectorAll('.tilt')) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 6}deg) translateY(-3px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  }
}

// ---------- catalog: rotating buddy ring, price ----------

const ring = $('#ring');
const ringStage = $('#ringStage');
let ringCards = [], ringAngle = 0, ringSpeed = 12, ringHover = false, ringDrag = null;

api('/api/catalog').then((cat) => {
  registerBuddies(cat.items);
  $('#bundlePrice').textContent = price(cat.bundle.price);
  // The website shows the 3D characters only (picture-based "realistic" buddies stay in the app).
  const items = cat.items.filter((b) => BUDDIES[b.id] && !b.image);
  ring.innerHTML = items.map((b) => `
    <a class="rcard" href="/signup" data-id="${esc(b.id)}" aria-label="${esc(b.name)} the ${esc(b.kind)}, ${esc(price(b.price))}">
      <div class="bimg"><img alt=""></div>
      <h4>${esc(b.name)}</h4>
      <div class="bmeta"><span>${esc(b.kind)}</span><span class="bprice ${b.price ? '' : 'free'}">${price(b.price)}</span></div>
    </a>`).join('');
  ringCards = [...ring.querySelectorAll('.rcard')];
  layoutRing();
  return portraits(createStage, items.map((b) => b.id), { size: 360, distance: 4.6, target: 1.0 }).then((pics) => {
    for (const el of ringCards) if (pics[el.dataset.id]) el.querySelector('img').src = pics[el.dataset.id];
  });
}).catch(() => {});

// Cards sit around a circle; the ring turns slowly, faces turn to you as they come round.
let ringRadius = 300;
function layoutRing() {
  const n = ringCards.length;
  if (!n) return;
  const w = ringCards[0].offsetWidth || 200;
  const gap = innerWidth < 700 ? 6 : 44; // tighter ring on phones so the side cards stay on screen
  ringRadius = Math.round((w / 2 + gap) / Math.tan(Math.PI / n));
}
addEventListener('resize', layoutRing);

function renderRing() {
  const n = ringCards.length;
  ringCards.forEach((el, i) => {
    const a = ((i / n) * 360 + ringAngle) % 360;
    const rad = (a * Math.PI) / 180;
    const front = (Math.cos(rad) + 1) / 2; // 1 = facing you, 0 = at the back
    el.style.transform = `rotateY(${a}deg) translateZ(${ringRadius}px)`;
    el.style.opacity = (0.28 + front * 0.72).toFixed(3);
    el.style.zIndex = Math.round(front * 100);
    el.classList.toggle('front', front > 0.93);
  });
}
let lastT = performance.now();
function spin(t) {
  const dt = Math.min(64, t - lastT);
  lastT = t;
  if (!ringDrag && !ringHover && !reduced) ringAngle -= (ringSpeed * dt) / 1000; // degrees per second
  renderRing();
  requestAnimationFrame(spin);
}
requestAnimationFrame(spin);

ringStage.addEventListener('pointerenter', () => { ringHover = true; });
ringStage.addEventListener('pointerleave', () => { ringHover = false; });
ringStage.addEventListener('pointerdown', (e) => { ringDrag = { x: e.clientX, a: ringAngle, moved: false }; });
addEventListener('pointermove', (e) => {
  if (!ringDrag) return;
  const dx = e.clientX - ringDrag.x;
  if (Math.abs(dx) > 4) ringDrag.moved = true;
  ringAngle = ringDrag.a + dx * 0.35;
});
addEventListener('pointerup', () => { setTimeout(() => { ringDrag = null; }, 0); });
ringStage.addEventListener('click', (e) => { if (ringDrag?.moved) e.preventDefault(); }, true);
$('#ringPrev').addEventListener('click', () => { ringAngle += 360 / Math.max(1, ringCards.length); });
$('#ringNext').addEventListener('click', () => { ringAngle -= 360 / Math.max(1, ringCards.length); });

api('/api/download').then(({ windows }) => {
  if (windows) return;
  $('#dl').classList.add('hidden');
  $('#dlNote').textContent = 'The Windows app is almost here — create your account now and use Peeky on the web.';
}).catch(() => {});

// ---------- try it: parse as you type, then the buddy acts it out ----------

const tryInput = $('#tryText');
const tryCanvas = $('#tryStage');
const tryStage = createStage(tryCanvas, { distance: 6.4 });
tryStage.setFraming({ toy: 0.4, tall: 0.62 });
const offscreen = () => tryStage.halfWidth + 1.3;
const tryReady = tryStage.setBuddy('robot').then(() => { tryStage.mover.position.x = offscreen(); });

const fmtWhen = (ms) => {
  const d = new Date(ms), t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  const secs = Math.round((ms - Date.now()) / 1000);
  if (secs > 0 && secs < 90) return `in ${secs} sec`;
  if (diff === 0) return `Today, ${t}`;
  if (diff === 1) return `Tomorrow, ${t}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${t}`;
};

let parsed = null, parseTimer = 0;
async function parseNow() {
  const text = tryInput.value.trim();
  parsed = text ? await api(`/api/parse?text=${encodeURIComponent(text)}`).catch(() => null) : null;
  const k = parsed?.buddy && BUDDIES[parsed.buddy] ? parsed.buddy : 'robot';
  $('#pTask').textContent = parsed ? parsed.text : text || '—';
  $('#pWhen').textContent = parsed ? fmtWhen(parsed.due) : 'Add a time, like “at 5pm”';
  $('#pBuddy').textContent = BUDDIES[k].name;
  for (const c of document.querySelectorAll('.pchip')) c.classList.toggle('hit', !!parsed);
  // The laptop's "Today" panel shows the reminder you're typing.
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  $('#dpLiveText').innerHTML = parsed ? `${esc(cap(parsed.text))}<small>${esc(fmtWhen(parsed.due))}</small>` : `${esc(text ? cap(text) : 'New reminder')}<small>add a time</small>`;
}
tryInput.addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(parseNow, 220); });
$('#tryExamples').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tryInput.value = b.textContent;
  parseNow();
  tryInput.focus();
});
parseNow();

// Taskbar clock on the laptop.
const tickClock = () => { $('#deskClock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
tickClock();
setInterval(tickClock, 15000);

// Play the demo once by itself the first time the laptop scrolls into view.
const autoplay = new IntersectionObserver((entries) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  autoplay.disconnect();
  setTimeout(() => { if (!running) $('#tryForm').requestSubmit(); }, 600);
}, { threshold: 0.45 });
autoplay.observe($('#desk2'));

async function walk(to, ms) {
  const from = tryStage.mover.position.x;
  tryStage.setMode('walk');
  tryStage.mover.rotation.y = (to < from ? -1 : 1) * (tryStage.flat ? 0.12 : 0.9);
  await tween(ms, (k) => { tryStage.mover.position.x = from + (to - from) * k; });
  const ry = tryStage.mover.rotation.y;
  await tween(220, (k) => { tryStage.mover.rotation.y = ry * (1 - k); });
}

let running = false, waitTimer = 0;
$('#tryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (running) return;
  await tryReady;
  await parseNow();
  if (!parsed) { tryInput.focus(); return; }
  running = true;
  const p = parsed;
  const k = p.buddy && BUDDIES[p.buddy] ? p.buddy : 'robot';
  $('#tryCard').classList.add('hidden');
  if (tryStage.mover.position.x < offscreen() - 0.1) await walk(offscreen(), 700);
  await tryStage.setBuddy(k);

  // Short countdowns play out for real; anything later is fast-forwarded.
  const wait = p.due - Date.now();
  const box = $('#tryWait');
  box.classList.remove('hidden');
  if (wait > 0 && wait <= 30000) {
    await new Promise((res) => {
      const tick = () => {
        const s = Math.max(0, Math.ceil((p.due - Date.now()) / 1000));
        box.innerHTML = `0:${String(s).padStart(2, '0')}<small>until ${esc(BUDDIES[k].name)} walks in</small>`;
        if (s <= 0) { clearInterval(waitTimer); res(); }
      };
      tick();
      waitTimer = setInterval(tick, 250);
    });
  } else {
    box.innerHTML = `${esc(fmtWhen(p.due))}<small>Skipping ahead for the demo…</small>`;
    await sleep(1100);
  }
  box.classList.add('hidden');

  tryStage.mover.position.x = offscreen();
  await walk(0, 1150);
  tryStage.setMode('wave');
  $('#tcWho').textContent = BUDDIES[k].name;
  $('#tcWhen').textContent = new Date(Math.max(p.due, Date.now())).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#tcTitle').textContent = p.text.charAt(0).toUpperCase() + p.text.slice(1);
  const card = $('#tryCard');
  card.querySelector('.hc-actions').classList.remove('hidden');
  card.classList.remove('hidden');
});

$('#tryCard').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tc]');
  if (!b) return;
  $('#tryCard .hc-actions').classList.add('hidden');
  if (b.dataset.tc === 'done') {
    tryStage.setMode('happy');
    confettiAt(b);
    $('#tcTitle').textContent = pick(['Nice work!', 'Nailed it!', 'Done and dusted.']);
  } else {
    tryStage.setMode('sleep');
    $('#tcTitle').textContent = 'Okay — back in 5 minutes.';
  }
  await sleep(1500);
  $('#tryCard').classList.add('hidden');
  await walk(offscreen(), 900);
  $('#dpLive').classList.toggle('done', b.dataset.tc === 'done');
  running = false;
});
