// End-to-end smoke test against a running server:  npm run smoke [-- https://your-domain.com]
// Creates a throwaway account, exercises the main flows, then deletes the account.
const BASE = (process.argv[2] || process.env.PEEKY_SERVER || 'http://localhost:8787').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
let cookie = '', lastSetCookie = '';
let failed = 0;

async function call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json', origin: ORIGIN } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) { cookie = set.split(';')[0]; lastSetCookie = set; }
  return { status: res.status, headers: res.headers, data: raw ? await res.text() : await res.json().catch(() => null) };
}
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed++;
}

(async () => {
  const email = `smoke-${Date.now()}@example.com`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  let r = await call('/healthz');
  check('health check', r.status === 200 && r.data?.ok);
  r = await call('/', { raw: true });
  check('landing page + security headers', r.status === 200 && r.headers.get('content-security-policy')?.includes("frame-ancestors 'none'") && r.headers.get('x-content-type-options') === 'nosniff');
  r = await call('/privacy', { raw: true });
  check('privacy page filled in', r.status === 200 && !r.data.includes('{{'));
  r = await call('/does-not-exist', { raw: true });
  check('404 page', r.status === 404 && r.data.includes('Page not found'));

  r = await call('/api/auth/signup', { method: 'POST', body: { name: 'Smoke Test', email, password: 'short' } });
  check('rejects weak password', r.status === 400);
  r = await call('/api/auth/signup', { method: 'POST', body: { name: 'Smoke Test', email, password } });
  check('sign up', r.status === 200 && r.data?.user?.email === email, JSON.stringify(r.data));
  check('session cookie is HttpOnly + SameSite', /HttpOnly/i.test(lastSetCookie) && /SameSite=Lax/i.test(lastSetCookie), lastSetCookie);

  r = await call('/api/me', { method: 'PATCH', body: { name: 'X' }, headers: { origin: 'https://evil.example' } });
  check('blocks cross-site writes', r.status === 403);

  r = await call('/api/notes/smoke1', { method: 'PUT', body: { text: 'Smoke\n[ ] stretch at 5pm', updated: Date.now() } });
  check('save note + parse reminder', r.status === 200 && r.data.note.reminders[0]?.text === 'stretch');
  r = await call('/api/notes/smoke1', { method: 'PUT', body: { text: 'stale', updated: 1 } });
  check('rejects stale overwrite', r.status === 409);
  r = await call('/api/notes');
  check('list notes', r.data?.notes?.length === 1);

  r = await call('/api/settings', { method: 'PATCH', body: { buddy: 'duck' } });
  check('locked buddy cannot be selected', r.status === 403);
  r = await call('/api/catalog');
  check('catalog', r.data?.items?.length >= 6, r.data?.store);
  const store = r.data.store;
  r = await call('/api/store/checkout', { method: 'POST', body: { item: 'duck' } });
  check(`checkout (${store} store)`, store === 'test' ? r.data?.granted : store === 'live' ? /^https:\/\/checkout\.stripe\.com/.test(r.data?.url || '') : r.status === 503, JSON.stringify(r.data));

  r = await call('/api/routine', { method: 'POST', body: { url: 'https://example.com/sheet' } });
  check('rejects non-Google sheet links', r.status === 400);

  r = await call('/api/auth/forgot', { method: 'POST', body: { email } });
  check('password reset request', r.status === 200);
  r = await call('/api/auth/reset', { method: 'POST', body: { token: 'bogus', password: 'new-password-123' } });
  check('rejects bad reset token', r.status === 400);

  r = await call('/api/device/start', { method: 'POST', body: { label: 'Smoke laptop' } });
  const dev = r.data;
  r = await call('/api/device/approve', { method: 'POST', body: { code: dev.userCode } });
  check('approve laptop sign-in', r.status === 200);
  r = await fetch(`${BASE}/api/device/poll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: dev.deviceCode }) }).then((x) => x.json());
  check('laptop receives token', r.status === 'ok' && !!r.token);
  const laptopToken = r.token;
  const me = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${r.token}` } }).then((x) => x.json());
  check('laptop token works', me.user?.email === email);

  r = await call('/api/me', { method: 'DELETE', body: { password: 'wrong' } });
  check('delete needs password', r.status === 401);
  r = await call('/api/me', { method: 'DELETE', body: { password } });
  check('delete account', r.status === 200);
  const after = await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${laptopToken}` } });
  check('deleted account signs out its laptops', after.status === 401);

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
