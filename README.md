# Peeky

Notes and daily routines with a 3D buddy that walks onto your laptop screen to remind you.

- **Web** (`server/` + `web/`): landing page, accounts, notes, Google Sheets routine, buddy store, devices.
- **Desktop** (`main.js` + `src/`): the edge-peeking notes panel and the on-screen 3D buddy. Signs in through the browser and syncs with the server.

## Run it locally

```
npm install
npm run seed      # optional: creates a demo account (see server/.env.example)
npm run server    # http://localhost:8787
npm start         # the desktop app (in a second terminal)
```

The desktop app talks to `http://localhost:8787` by default; set `PEEKY_SERVER` to point it elsewhere.

## How it works

1. **Sign up** on the website.
2. **Sign in on the laptop:** the app shows a code and opens the browser; click **Allow** and the laptop is linked
   (device-code sign-in, like TV apps — no password typed into the desktop app). Linked computers are listed under
   **Devices** on the web, where they can be signed out remotely.
3. **Reminders come from two places:**
   - **Notes** — any line with a time becomes a reminder: `[ ] call mom at 5pm`, `stretch in 20 min #cat`,
     `standup tomorrow 9:30am`. Notes sync between the web and every linked computer.
   - **Google Sheets routine** — a sheet with `Time | Task | Days | Buddy` columns, shared as
     "Anyone with the link can view". Each row fires once on each matching day (Daily, Weekdays, Weekends, Mon/Wed/Fri…).
     The server re-reads the sheet every 15 minutes; the laptop picks up changes every 5.
4. **The buddy** walks in at the bottom-right of the screen beside a notification card, says the task out loud,
   follows the cursor with its eyes, nags if ignored, and offers **Done / 5 min / 15 min**. Done ticks the checkbox
   in the note on every device.

## Everyday features (desktop app)

- **Quick add:** type "call mom at 5pm" in the bar at the top of the panel; it lands in an Inbox note with a reminder.
- **Today tab:** done-today count, streak, focus session (25/50 min — the buddy tells you when time's up) and
  "Pause reminders" for meetings.
- **Healthy nudges:** optional water, stretch, eye-break and posture nudges at intervals you choose. The buddy asks,
  you answer **Yes** or **Later**. Nudges wait while a focus session runs.
- **Realistic buddies:** "cut-out" buddies made from a single picture walk in at full height
  (see [server/models/README.md](server/models/README.md) and `npm run cutout`).
- **Design:** midnight black, electric cobalt and acid lime, flat colours only.

## Store / in-app purchases

- Buddies are listed in `server/catalog.json` with a price in cents; `0` is free. `"Every Buddy"` unlocks all.
- With `STRIPE_SECRET_KEY` set, **Get** opens Stripe Checkout and the purchase is granted after Stripe confirms payment.
- Without a key the store runs in **test mode**: purchases unlock immediately and nothing is charged (the UI says so).
- Ownership is enforced on the server; the desktop app falls back to a free buddy for anything not owned.

**Adding your own 3D models:** see [server/models/README.md](server/models/README.md) — drop in a `.glb`, add one
catalog entry, done.

## Configuration

See [server/.env.example](server/.env.example): `PORT`, `PUBLIC_URL`, `STRIPE_SECRET_KEY`, `PEEKY_DATA_DIR`.
Data is stored in SQLite (`server/data/peeky.db`, Node's built-in `node:sqlite`).

## Going live

Follow **[LAUNCH.md](LAUNCH.md)**: deploy with `render.yaml`/`Dockerfile`, add Stripe + Resend keys, build the installer with
`npm run dist -- https://your-domain`, and verify with `npm run smoke -- https://your-domain`.

Production safeguards already in place: hashed passwords and session tokens, HttpOnly/SameSite cookies, CSP/HSTS headers,
cross-site write blocking, rate limits, verified Stripe webhooks, password reset by email, account deletion, store closed
(never free) when Stripe isn't configured, graceful shutdown and a `/healthz` check.

Google Sheets uses link sharing; a "Sign in with Google" connection (OAuth + Sheets API) can be added later for private sheets.

## Layout

| Path | What it is |
|---|---|
| `server/index.js` | API: auth, notes sync, store/Stripe, Google Sheets routine, device sign-in |
| `server/sheets.js` | Reads and parses the routine sheet |
| `server/catalog.json` | Buddies and prices |
| `web/` | Website and web app (Apple-style, responsive, light/dark) |
| `main.js` | Desktop: windows, tray, sync, scheduler |
| `src/panel.*` | Desktop notes panel |
| `src/buddy.*` | Desktop on-screen buddy |
| `src/buddies.js` | 3D buddies (built-in + `.glb` loader), shared by web and desktop |
| `src/parse.js` | Natural-language time parser, shared by server and desktop |
