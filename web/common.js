// Shared helpers for the Peeky web pages.

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const $ = (s, root = document) => root.querySelector(s);
export const price = (cents) => (cents ? `$${(cents / 100).toFixed(2)}` : 'Free');

let toastEl, toastTimer;
export function toast(msg) {
  toastEl ||= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toast', role: 'status' });
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// SF Symbols–style line icons.
const P = {
  note: '<path d="M6 3.5h9l3.5 3.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z"/><path d="M8 9.5h8M8 13h8M8 16.5h5"/>',
  routine: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h2M14 13.5h2M8 17h2"/>',
  buddy: '<rect x="5" y="7" width="14" height="11" rx="4.5"/><path d="M12 3.5V7"/><circle cx="12" cy="3" r=".9" fill="currentColor"/><path d="M9.5 11.5v1.5M14.5 11.5v1.5"/>',
  devices: '<rect x="4" y="5" width="16" height="11" rx="1.8"/><path d="M2 19.5h20"/>',
  account: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.3-3.6 4.2-5.4 7.5-5.4s6.2 1.8 7.5 5.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 12.2a1.6 1.6 0 0 0 1.6 1.3h6a1.6 1.6 0 0 0 1.6-1.3l.9-12.2"/>',
  sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9M4.5 12a7.5 7.5 0 0 1 13.2-4.9"/><path d="M18 3.5v4h-4M6 20.5v-4h4"/>',
  sheet: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M4.5 9h15M4.5 14.5h15M10 9v11.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  edge: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M16 8v8"/>',
  check: '<path d="M5 12.5l4.2 4L19 7"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};
export const icon = (name, cls = 'i') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

// Renders small portraits of buddies with one offscreen WebGL context.
export async function portraits(createStage, keys, { size = 160, distance = 4.3, target = 1.0 } = {}) {
  const stage = createStage(document.createElement('canvas'), { size: [size, size], distance, target });
  const out = {};
  for (const k of keys) out[k] = await stage.snapshot(k);
  stage.dispose();
  return out;
}

export const NAV_HTML = (user) => `
  <nav class="nav"><div class="wrap">
    <a class="logo" href="/"><span class="logo-mark"></span>Peeky</a>
    <div class="nav-links">
      <a class="opt" href="/#features">Features</a>
      <a class="opt" href="/#routine">Routines</a>
      <a class="opt" href="/#buddies">Buddies</a>
      <a class="opt" href="/#pricing">Pricing</a>
      ${user ? `<a href="/app">Open Peeky</a>` : `<a href="/signin">Sign in</a>`}
    </div>
  </div></nav>`;
