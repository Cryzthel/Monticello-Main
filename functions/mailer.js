/**
 * Transactional mail for the Cloud Functions: one send function, two
 * providers, and the password-reset template.
 *
 * ── WHICH PROVIDER ─────────────────────────────────────────────────────────
 *   MAIL_PROVIDER=resend   Resend's HTTPS API, from MAIL_FROM on a domain you
 *                          have verified with Resend (SPF + DKIM + DMARC).
 *                          This is the one that lands in the primary inbox.
 *   MAIL_PROVIDER=smtp     (default) the estate's Gmail account over SMTP —
 *                          what ran before. Kept so mail keeps flowing until
 *                          a sending domain exists; Gmail-to-Gmail from a
 *                          personal account is the configuration most likely
 *                          to be filed under Spam or Promotions.
 *
 * Both are set in functions/.env (see .env.example); the API key and the SMTP
 * password are Secret Manager secrets, never env values. MAIL_SETUP.md has the
 * DNS records and the switch-over steps.
 *
 * ── NOTHING CAN GUARANTEE THE INBOX ────────────────────────────────────────
 * Authentication (SPF/DKIM/DMARC aligned on your own domain), a plain
 * template, and a low complaint rate are what Gmail rewards. They make the
 * inbox very likely; Gmail alone decides. The template below avoids what its
 * filters punish: no images, no links, no tracking, a real text part, one
 * subject that never changes shape.
 */

const nodemailer = require("nodemailer");

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function provider() {
  return String(process.env.MAIL_PROVIDER || "smtp").trim().toLowerCase();
}

/**
 * The Secret Manager secrets the ACTIVE provider needs, for `runWith`.
 *
 * Read at deploy time, when the Firebase CLI loads functions/.env into the
 * environment, so a deploy only asks for the secrets it will actually use —
 * switching to Resend does not demand the Gmail password, and staying on SMTP
 * does not demand a Resend key you have not created yet.
 */
function mailSecrets() {
  return provider() === "resend" ? ["RESEND_API_KEY"] : ["SMTP_USER", "SMTP_PASS"];
}

function senderAddress() {
  if (provider() === "resend") {
    const from = String(process.env.MAIL_FROM || "").trim();
    if (!from) throw new Error("MAIL_FROM is not set (see functions/.env.example).");
    return from;
  }
  return `"Monticello Villas" <${process.env.SMTP_USER}>`;
}

async function sendViaResend(message) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY secret is not available to this function.");
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderAddress(),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
      ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
    }),
  });
  if (!res.ok) {
    // Resend's error body names the problem ("domain is not verified") —
    // logged, never returned to the caller.
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 300)}`);
  }
}

async function sendViaSmtp(message) {
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: senderAddress(), ...message });
}

/** Sends one message through whichever provider is configured. */
async function sendMail(message) {
  return provider() === "resend" ? sendViaResend(message) : sendViaSmtp(message);
}

/**
 * The password-reset code email. Pure, so its content is unit-tested.
 *
 *   • The code leads the text part, so it is the first thing in the inbox
 *     preview — and what iOS / Android one-time-code autofill looks for.
 *   • One subject for every message, never the code in it: a subject that
 *     changes per message reads as bulk, and a code in a subject sits on the
 *     lock screen of anyone holding the phone.
 *   • No links, no images, no tracking pixel. A code has nothing to click,
 *     and remote content is what makes mail look like marketing.
 *   • The security lines are the industry-standard pair: ignore it if it was
 *     not you, and staff will never ask for it.
 */
function buildResetCodeEmail(otp, ttlMinutes) {
  const code = String(otp);
  const subject = "Your Monticello Villas password reset code";
  const text = [
    `${code} is your Monticello Villas password reset code.`,
    "",
    `It expires in ${ttlMinutes} minutes and can be used once.`,
    "",
    "If you didn't ask to reset your password, you can ignore this email. " +
      "Your password has not changed.",
    "",
    "The HOA office will never ask you for this code.",
    "",
    "— Monticello Villas HOA",
  ].join("\n");

  // System fonts only: a webfont is a remote request, and it would not load.
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#0F172A;max-width:480px">` +
    `<p style="margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:.08em;` +
    `color:#047857;text-transform:uppercase">Monticello Villas</p>` +
    `<p style="margin:0 0 12px">Your password reset code is:</p>` +
    `<p style="margin:0 0 20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;` +
    `font-size:34px;font-weight:700;letter-spacing:10px;color:#0F172A">${code}</p>` +
    `<p style="margin:0 0 16px">It expires in ${ttlMinutes} minutes and can be used once.</p>` +
    `<p style="margin:0 0 8px;color:#475569">If you didn't ask to reset your password, you ` +
    `can ignore this email. Your password has not changed.</p>` +
    `<p style="margin:0 0 24px;color:#475569">The HOA office will never ask you for this code.</p>` +
    `<p style="margin:0;font-size:12px;color:#94A3B8">Monticello Villas HOA · automated message</p>` +
    `</div>`;

  return { subject, text, html };
}

module.exports = { sendMail, mailSecrets, buildResetCodeEmail, provider };
