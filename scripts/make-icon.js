// Writes build/icon.png (512×512): the Peeky mark — a dark rounded square with two eyes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 512;
const px = Buffer.alloc(S * S * 4);
const R = 112, PAD = 24;

// Signed distance helpers with 1px anti-aliasing.
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d));
function roundRect(x, y) {
  const cx = Math.min(Math.max(x, PAD + R), S - PAD - R), cy = Math.min(Math.max(y, PAD + R), S - PAD - R);
  return Math.hypot(x - cx, y - cy) - R;
}
function capsule(x, y, ex) {
  const w = 34, top = 210, bottom = 300;
  const cy = Math.min(Math.max(y, top), bottom);
  return Math.hypot(x - ex, y - cy) - w;
}

for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const bg = cover(roundRect(x + 0.5, y + 0.5));
  const eye = Math.max(cover(capsule(x + 0.5, y + 0.5, 196)), cover(capsule(x + 0.5, y + 0.5, 316)));
  const v = Math.round(29 + (250 - 29) * eye);
  const i = (y * S + x) * 4;
  px[i] = v; px[i + 1] = v; px[i + 2] = Math.round(31 + (250 - 31) * eye); px[i + 3] = Math.round(255 * bg);
}

// Minimal PNG encoder (RGBA, filter 0).
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out}`);
