// Turns a picture of a standing character on a plain background into a Peeky cut-out buddy.
//   npm run cutout -- path/to/picture.jpg buddy-id
// Writes server/models/<buddy-id>.png (transparent, trimmed) and prints the catalog entry to add.
// Runs inside Electron only because Electron can decode JPG/PNG without extra dependencies.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const [input, id] = process.argv.slice(-2);
const fail = (msg) => { console.error(msg); app.exit(1); };

app.whenReady().then(() => {
  if (!input || !id || !/^[a-z0-9-]+$/.test(id)) return fail('Usage: npm run cutout -- path/to/picture.jpg buddy-id   (id: lowercase letters, numbers, dashes)');
  if (!fs.existsSync(input)) return fail(`Picture not found: ${input}`);
  const img = nativeImage.createFromPath(path.resolve(input));
  if (img.isEmpty()) return fail(`Couldn't read ${input} as an image.`);
  const { width: W, height: H } = img.getSize();
  const px = img.toBitmap(); // BGRA
  const at = (x, y) => (y * W + x) * 4;

  // Background colour = average of the four corners.
  const bg = [0, 0, 0];
  let n = 0;
  for (const [cx, cy] of [[0, 0], [W - 8, 0], [0, H - 8], [W - 8, H - 8]]) {
    for (let y = cy; y < cy + 8; y++) for (let x = cx; x < cx + 8; x++) { const i = at(x, y); bg[0] += px[i]; bg[1] += px[i + 1]; bg[2] += px[i + 2]; n++; }
  }
  bg.forEach((v, k) => { bg[k] = v / n; });
  const dist = (i) => Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));

  // Remove background: anything reachable from the border that's close to the background colour,
  // plus enclosed pockets (between an arm and the body) that match it very closely.
  const NEAR = 30, EXACT = 12;
  const gone = new Uint8Array(W * H);
  const stack = [];
  const visit = (x, y) => { const p = y * W + x; if (!gone[p] && dist(p * 4) < NEAR) { gone[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { visit(x, 0); visit(x, H - 1); }
  for (let y = 0; y < H; y++) { visit(0, y); visit(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p / W) | 0;
    if (x > 0) visit(x - 1, y);
    if (x < W - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < H - 1) visit(x, y + 1);
  }
  for (let p = 0; p < W * H; p++) if (!gone[p] && dist(p * 4) < EXACT) gone[p] = 1;

  // Shave the outline: edge pixels still tinted by the background would show as a pale fringe.
  const FRINGE = 80;
  for (let pass = 0; pass < (H > 800 ? 2 : 1); pass++) {
    const shave = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (!gone[p] && (gone[p - 1] || gone[p + 1] || gone[p - W] || gone[p + W]) && dist(p * 4) < FRINGE) shave.push(p);
    }
    for (const p of shave) gone[p] = 1;
  }

  // Alpha with a soft 1px edge, then trim to the character.
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (gone[p]) continue;
    const edge = (x > 0 && gone[p - 1]) || (x < W - 1 && gone[p + 1]) || (y > 0 && gone[p - W]) || (y < H - 1 && gone[p + W]);
    alpha[p] = edge ? Math.min(255, Math.round((dist(p * 4) / (NEAR * 2)) * 255)) : 255;
    if (alpha[p] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 <= x0 || y1 <= y0) return fail('No character found — is the background plain and different from the character?');
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = at(x + x0, y + y0), d = (y * w + x) * 4, a = alpha[(y + y0) * W + x + x0];
    out[d] = (px[s] * a) / 255; out[d + 1] = (px[s + 1] * a) / 255; out[d + 2] = (px[s + 2] * a) / 255; out[d + 3] = a; // premultiplied
  }

  // Find the gap between the legs: the column near the middle with the tallest empty run up from the feet.
  let best = { run: 0, x: Math.round(w / 2) };
  for (let x = Math.round(w * 0.3); x < w * 0.7; x++) {
    let run = 0;
    while (run < h && out[((h - 1 - run) * w + x) * 4 + 3] < 40) run++;
    if (run > best.run) best = { run, x };
  }
  const hip = Math.min(0.6, Math.max(0.3, best.run / h + 0.02));
  const split = best.run > h * 0.1 ? best.x / w : 0.5;

  const dest = path.join(__dirname, '..', 'server', 'models', `${id}.png`);
  fs.writeFileSync(dest, nativeImage.createFromBitmap(out, { width: w, height: h }).toPNG());
  console.log(`Saved ${path.relative(process.cwd(), dest)} (${w}×${h})`);
  if (h < 600) console.log('Note: this picture is small — use one at least 1000px tall for a crisp buddy.');
  console.log('\nAdd this to "items" in server/catalog.json (edit the name, kind, price and lines):\n');
  console.log(JSON.stringify({
    id, name: id.charAt(0).toUpperCase() + id.slice(1), kind: 'Buddy', price: 199,
    image: `/models/${id}.png`, hip: +hip.toFixed(3), split: +split.toFixed(3),
    blurb: 'Describe this buddy in one line.', hello: 'Hey! Quick reminder.', voice: { pitch: 1, rate: 1 },
  }, null, 2));
  app.exit(0);
});
