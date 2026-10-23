// Transactional email through Resend's HTTP API (https://resend.com).
// Without RESEND_API_KEY (local development) messages are printed to the server log instead.
const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'Peeky <hello@example.com>';

async function sendMail({ to, subject, text, html }) {
  if (!KEY) {
    console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
}

const button = (url, label) =>
  `<a href="${url}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:12px 22px;border-radius:980px;font-weight:500">${label}</a>`;
const layout = (body) =>
  `<div style="font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f;max-width:480px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:600;font-size:19px;margin-bottom:24px">Peeky</div>${body}
    <p style="color:#86868b;font-size:13px;margin-top:32px">If you didn't ask for this, you can ignore this email.</p></div>`;

module.exports = { sendMail, button, layout, configured: !!KEY };
