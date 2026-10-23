// Natural-language time parsing for note lines, e.g.
//   "[ ] call mom at 5pm"   "stretch in 20 min #cat"   "standup tomorrow 9:30am"
const UNITS = {
  s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3,
  m: 6e4, min: 6e4, mins: 6e4, minute: 6e4, minutes: 6e4,
  h: 36e5, hr: 36e5, hrs: 36e5, hour: 36e5, hours: 36e5,
};
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const BUDDIES = ['robot', 'cat', 'penguin', 'ghost', 'slime', 'duck'];
const CHECKBOX = /^(\s*(?:[-*•]\s*)?)\[([ xX])\]\s*/;
const PREFIX = /^\s*(?:[-*•]\s*)?(?:\[[ xX]\]\s*)?/;

// Stable identity of a line, independent of its checkbox state.
const keyOf = (line) => line.replace(PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase();

function parseLine(line, now = Date.now()) {
  const lower = line.toLowerCase();
  const cuts = [];
  const take = (m) => cuts.push([m.index, m[0].length]);
  let due = null;
  let m;

  if ((m = lower.match(/\bin\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/))) {
    take(m);
    due = now + parseFloat(m[1]) * UNITS[m[2]];
  } else if ((m = lower.match(/\bin\s+half\s+an?\s+hour\b/))) {
    take(m);
    due = now + 30 * 6e4;
  } else if ((m = lower.match(/\bin\s+(?:an?|one)\s+(hour|minute)\b/))) {
    take(m);
    due = now + UNITS[m[1]];
  } else {
    const d = new Date(now);
    let dayGiven = false, weekdayGiven = false, time = null, ambiguous = false, fallback = [9, 0];

    if ((m = lower.match(/\b(today|tonight|tomorrow|tmrw|tmr)\b/))) {
      take(m);
      dayGiven = true;
      if (m[1] === 'tonight') fallback = [20, 0];
      if (/^(tom|tm)/.test(m[1])) d.setDate(d.getDate() + 1);
    } else if ((m = lower.match(/\b(?:on\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
      take(m);
      weekdayGiven = true;
      let diff = (DAYS.indexOf(m[1]) - d.getDay() + 7) % 7;
      if (diff === 0 && m[0].startsWith('next')) diff = 7;
      d.setDate(d.getDate() + diff);
    }

    if ((m = lower.match(/(?:\b(?:at|by)\s+|@\s*)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/))) {
      take(m);
      let h = +m[1] % 12;
      if (m[3][0] === 'p') h += 12;
      time = [h, +(m[2] || 0)];
    } else if ((m = lower.match(/(?:\b(?:at|by)\s+|@\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
      take(m);
      time = [+m[1], +m[2]];
      ambiguous = time[0] >= 1 && time[0] <= 11 && !m[1].startsWith('0');
    } else if ((m = lower.match(/\b(noon|midday|midnight)\b/))) {
      take(m);
      time = m[1] === 'midnight' ? [0, 0] : [12, 0];
    } else if ((m = lower.match(/(?:\b(?:at|by)\s+|@\s*)(\d{1,2})\b(?![:.]\d)/)) && +m[1] <= 23) {
      take(m);
      time = [+m[1], 0];
      ambiguous = time[0] >= 1 && time[0] <= 11;
    } else if ((m = lower.match(/\b(?:this\s+|in\s+the\s+)?(morning|afternoon|evening)\b/))) {
      take(m);
      time = { morning: [9, 0], afternoon: [15, 0], evening: [19, 0] }[m[1]];
    }

    if (!time && !dayGiven && !weekdayGiven) return null;
    const [h, min] = time || fallback;
    d.setHours(h, min, 0, 0);

    // "at 6" almost always means 6pm; "at 9" means the next 9 o'clock that hasn't passed.
    if (ambiguous) {
      if (h < 7 || fallback[0] === 20) d.setHours(h + 12);
      else if (d.getTime() <= now) {
        d.setHours(h + 12);
        if (d.getTime() <= now) { d.setHours(h); d.setDate(d.getDate() + 1); }
      }
    }
    if (d.getTime() <= now) {
      if (weekdayGiven) d.setDate(d.getDate() + 7);
      else if (!dayGiven) d.setDate(d.getDate() + 1);
    }
    due = d.getTime();
  }

  let text = line;
  for (const [i, len] of cuts.sort((a, b) => b[0] - a[0])) text = text.slice(0, i) + ' ' + text.slice(i + len);

  let buddy = '';
  text = text.replace(/#(\w+)/g, (all, w) => {
    if (!BUDDIES.includes(w.toLowerCase())) return all;
    buddy = w.toLowerCase();
    return ' ';
  });
  text = text
    .replace(PREFIX, '')
    .replace(/\b(remind me to|remind me|reminder:?)\s*/i, '')
    .replace(/\s+(at|on|by|@)\s*$/i, '')
    .replace(/^\s*(at|on|by)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim();

  return { due, text: text || 'your thing', buddy };
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Re-derives a note's reminders from its text, keeping due/fired state for lines that didn't change
// (so "in 10 min" doesn't keep moving, and a reminder that already went off doesn't go off again).
function parseNote(note, prev = [], now = Date.now()) {
  const byKey = new Map(prev.map((r) => [r.key, r]));
  const seen = new Map();
  const out = [];
  note.text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const p = parseLine(line, now);
    if (!p) return;
    const base = keyOf(line);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const key = n > 1 ? `${base}~~${n}` : base;
    const cb = line.match(CHECKBOX);
    const done = !!cb && cb[2].toLowerCase() === 'x';
    const old = byKey.get(key);
    let fired = old ? old.fired : done;
    if (old && old.done && !done && old.due > now) fired = false;
    out.push({
      id: old ? old.id : `${note.id}-${hash(key)}`,
      key, line: i, text: p.text, buddy: p.buddy, done,
      due: old ? old.due : p.due,
      fired,
      snoozed: old ? !!old.snoozed : false,
    });
  });
  return out;
}

module.exports = { parseLine, parseNote, keyOf, CHECKBOX, BUDDIES };
