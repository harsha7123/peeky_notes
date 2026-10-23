import { createStage, BUDDIES, registerBuddies } from '/shared/buddies.js';
import { api, esc, icon, price, portraits, NAV_HTML, $ } from './common.js';

const { user } = await api('/api/session');
$('#nav').innerHTML = NAV_HTML(user);
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

// Hero: a live buddy in the mock laptop that watches the cursor.
const heroCanvas = $('#heroBuddy');
const hero = createStage(heroCanvas, { distance: 6.2 });
await hero.setBuddy('robot');
hero.setMode('wave');
addEventListener('pointermove', (e) => {
  const r = heroCanvas.getBoundingClientRect();
  hero.lookAt((e.clientX - (r.left + r.width / 2)) / 500, (r.top + r.height * 0.3 - e.clientY) / 400);
});
heroCanvas.addEventListener('click', () => { hero.setMode('happy'); setTimeout(() => hero.setMode('wave'), 1100); });

// Download button only when an installer is published.
api('/api/download').then(({ windows }) => {
  if (windows) return;
  $('#dl').classList.add('hidden');
  $('#dlNote').textContent = 'The Windows app is coming very soon — create your account now and use Peeky on the web.';
});

// Buddy shelf from the live catalog.
const cat = await api('/api/catalog');
registerBuddies(cat.items);
$('#bundlePrice').textContent = price(cat.bundle.price);
const shelf = $('#shelf');
shelf.innerHTML = cat.items.map((b) => `<div class="card b" data-id="${esc(b.id)}"><img alt="${esc(b.name)} the ${esc(b.kind)}"><b>${esc(b.name)}</b><small>${esc(b.kind)} · ${price(b.price)}</small></div>`).join('');
const pics = await portraits(createStage, cat.items.map((b) => b.id).filter((k) => BUDDIES[k]));
for (const el of shelf.querySelectorAll('[data-id]')) if (pics[el.dataset.id]) el.querySelector('img').src = pics[el.dataset.id];
