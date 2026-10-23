// Builds the Windows installer with the production server address baked in.
//   npm run dist -- https://your-domain.com
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const server = (process.argv[2] || process.env.PEEKY_SERVER || '').replace(/\/$/, '');
if (!/^https:\/\//.test(server) && !process.env.ALLOW_HTTP) {
  console.error('Usage: npm run dist -- https://your-domain.com   (the address where the Peeky server runs)');
  process.exit(1);
}

let root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'make-icon.js')], { stdio: 'inherit' });

// The NSIS installer compiler can't handle long Windows paths, so build from a temporary short drive letter.
let drive = null;
if (process.platform === 'win32' && root.length > 80) {
  drive = 'PQRSTUVWXY'.split('').find((d) => !fs.existsSync(`${d}:\\`));
  execFileSync('subst', [`${drive}:`, root]);
  root = `${drive}:\\`;
}
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), '--win', '--x64', `-c.extraMetadata.peeky.server=${server}`], { stdio: 'inherit', cwd: root });
} finally {
  if (drive) execFileSync('subst', [`${drive}:`, '/d']);
}
console.log(`\nInstaller: dist/Peeky-Setup-*.exe (server: ${server})`);
console.log('Upload it (e.g. as a GitHub Release asset) and set WINDOWS_DOWNLOAD_URL, or copy it into server/downloads/.');
