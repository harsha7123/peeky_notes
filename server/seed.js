// Creates a local demo account for development. Credentials come from server/.env.example defaults.
const crypto = require('crypto');
const db = require('./db');

const email = process.env.DEMO_EMAIL || 'demo@peeky.local';
const password = process.env.DEMO_PASSWORD || 'peeky-demo-2026';

if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
  console.log(`Demo account already exists: ${email}`);
} else {
  const salt = crypto.randomBytes(16).toString('hex');
  const pass = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
  db.prepare('INSERT INTO users (id, email, name, pass, created) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomBytes(9).toString('base64url'), email, 'Demo', pass, Date.now());
  console.log(`Created demo account: ${email} (password in server/.env.example)`);
}
