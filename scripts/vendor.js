// Copies the three.js add-ons the desktop app uses into src/vendor/.
// electron-builder always drops node_modules/*/examples/, which is where three.js keeps its add-ons,
// so the packaged app loads them from here instead. Runs automatically after `npm install`.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const from = path.join(root, 'node_modules', 'three', 'examples', 'jsm');
const to = path.join(root, 'src', 'vendor', 'three-addons');
const FILES = [
  'loaders/GLTFLoader.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'environments/RoomEnvironment.js',
  'geometries/RoundedBoxGeometry.js',
];

if (!fs.existsSync(from)) {
  console.log('three.js not installed yet; skipping vendor copy');
  process.exit(0);
}
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
  fs.copyFileSync(path.join(from, f), path.join(to, f));
}
console.log(`vendored ${FILES.length} three.js add-ons into src/vendor/three-addons`);
