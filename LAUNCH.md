# Launch checklist

About an hour end to end. You need: a GitHub account, a domain name, a Render account, a Stripe account and a Resend account.

## 1. Put the code on GitHub
Create a **private** repository and push this folder (`.gitignore` already leaves out `node_modules`, the database and builds).

## 2. Deploy the server (Render)
1. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`: a Docker web service with a 1 GB persistent disk for the database and a `/healthz` health check.
2. Fill in the environment variables it asks for (see below; you can add the Stripe/Resend ones after steps 3–4 and redeploy).
3. Render → your service → **Settings → Custom Domains** → add your domain (e.g. `peeky.app`) and set the DNS record it shows. HTTPS is automatic.
4. Set `PUBLIC_URL` to `https://your-domain`.

| Variable | Value |
|---|---|
| `PUBLIC_URL` | `https://your-domain` |
| `COMPANY_NAME`, `SUPPORT_EMAIL` | Shown on /privacy and /terms |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Step 3 |
| `RESEND_API_KEY`, `MAIL_FROM` | Step 4 |
| `WINDOWS_DOWNLOAD_URL` | Step 5 |

## 3. Payments (Stripe)
1. Activate your Stripe account (business details + bank account).
2. **Developers → API keys** → copy the **secret key** (`sk_live_…`) → `STRIPE_SECRET_KEY`.
3. **Developers → Webhooks → Add endpoint** → `https://your-domain/api/stripe/webhook`, events
   `checkout.session.completed` and `checkout.session.async_payment_succeeded` → copy the signing secret (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

Until `STRIPE_SECRET_KEY` is set, production shows "Store opens soon" and **never** unlocks paid buddies for free.
Tip: try it first with `sk_test_…` keys and card `4242 4242 4242 4242`, then switch to live keys.

## 4. Email (Resend)
1. Resend → **Domains** → add your domain and set the DNS records.
2. **API Keys** → create one → `RESEND_API_KEY`. Set `MAIL_FROM` to e.g. `Peeky <hello@your-domain>`.

Used for password-reset and welcome emails. Without it, emails only appear in the server log (password reset won't reach users).

## 5. The Windows app
```
npm run dist -- https://your-domain
```
This builds `dist/Peeky-Setup-1.0.0.exe` with your server address baked in. Upload it to a **GitHub Release** of your repo and put its download link in `WINDOWS_DOWNLOAD_URL`. The "Download for Windows" buttons on the site appear automatically.

**Code signing:** the installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" (users click **More info → Run anyway**).
To remove that, sign it with a code-signing certificate or Azure Trusted Signing and set `CSC_LINK`/`CSC_KEY_PASSWORD` before `npm run dist`.

## 6. Check it
```
npm run smoke -- https://your-domain
```
Creates a throwaway account, tests sign-up, notes, security, store, password reset, laptop sign-in and account deletion, then deletes the account. Then do one real purchase of a buddy yourself (and refund it in Stripe).

## 7. After launch
- **Backups:** Render snapshots persistent disks daily; you can also download `/data/peeky.db`.
- **Logs and uptime:** Render dashboard → Logs; add an uptime monitor on `https://your-domain/healthz`.
- **Legal:** `/privacy` and `/terms` are plain-language templates — have them checked for your country.
- **Releasing app updates:** bump `version` in `package.json`, `npm run dist -- https://your-domain`, upload, update `WINDOWS_DOWNLOAD_URL`.
