// Reads a daily routine from a Google Sheet shared as "Anyone with the link can view".
// Expected columns (any order, case-insensitive): Time | Task | Days | Buddy | Note
const crypto = require('crypto');

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function csvUrl(url) {
  const u = new URL(String(url).trim());
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || !u.pathname.startsWith('/spreadsheets/')) {
    throw new Error('Paste a Google Sheets link (https://docs.google.com/spreadsheets/…).');
  }
  // "Publish to web" links already point at an export; just ask for CSV.
  const published = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\//);
  if (published) return `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv${u.searchParams.get('gid') ? `&gid=${u.searchParams.get('gid')}` : ''}`;
  const id = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
  if (!id) throw new Error("That doesn't look like a spreadsheet link.");
  const gid = (u.hash.match(/gid=(\d+)/) || [])[1] || u.searchParams.get('gid') || '0';
  return `https://docs.google.com/spreadsheets/d/${id[1]}/export?format=csv&gid=${gid}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function parseTime(s) {
  const m = String(s).trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  if (m[3]) { h %= 12; if (m[3][0] === 'p') h += 12; }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseDays(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v || /^(daily|every ?day|all|everyday)$/.test(v)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^week ?days?$/.test(v)) return [1, 2, 3, 4, 5];
  if (/^week ?ends?$/.test(v)) return [0, 6];
  const out = new Set();
  for (const part of v.split(/[\s,/;&]+|\band\b/).filter(Boolean)) {
    const range = part.match(/^([a-z]{3})[a-z]*-([a-z]{3})[a-z]*$/);
    if (range) {
      let a = DAY_NAMES.indexOf(range[1]);
      const b = DAY_NAMES.indexOf(range[2]);
      if (a < 0 || b < 0) continue;
      for (;;) { out.add(a); if (a === b) break; a = (a + 1) % 7; }
      continue;
    }
    const d = DAY_NAMES.indexOf(part.slice(0, 3));
    if (d >= 0) out.add(d);
  }
  return [...out].sort();
}

function toItems(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iTime = col('time', 'when'), iTask = col('task', 'activity', 'what', 'todo', 'to-do');
  const iDays = col('day', 'repeat'), iBuddy = col('buddy'), iNote = col('note', 'detail');
  if (iTime < 0 || iTask < 0) throw new Error('Your sheet needs a "Time" column and a "Task" column in the first row.');
  const items = [];
  for (const r of rows.slice(1)) {
    const time = parseTime(r[iTime] || '');
    const task = (r[iTask] || '').trim();
    if (!time || !task) continue;
    const days = iDays >= 0 ? parseDays(r[iDays]) : [0, 1, 2, 3, 4, 5, 6];
    const buddy = iBuddy >= 0 ? (r[iBuddy] || '').trim().toLowerCase() : '';
    const note = iNote >= 0 ? (r[iNote] || '').trim() : '';
    const id = crypto.createHash('sha1').update(`${time}|${task}|${days}`).digest('hex').slice(0, 12);
    items.push({ id, time, task, days, buddy, note });
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}

async function fetchRoutine(url) {
  const res = await fetch(csvUrl(url), { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('text/html')) {
    throw new Error('Peeky couldn\'t open that sheet. In Google Sheets, click Share → General access → "Anyone with the link".');
  }
  return toItems(parseCsv(await res.text()));
}

module.exports = { fetchRoutine, csvUrl, parseCsv, parseTime, parseDays, toItems };
