/**
 * The reset-code email and the provider switch, under bare node.
 *
 *   node scripts/mailer.test.cjs
 *
 * The functions cannot run on the Spark plan, so what the email SAYS and which
 * service it goes through are pinned here instead of being found out from a
 * resident's Spam folder. `fetch` is replaced, so nothing is sent.
 */

"use strict";

const assert = require("assert");
const path = require("path");

const mailerPath = path.join(__dirname, "..", "mailer.js");

/** A fresh module per case, because the provider is read from the env. */
function load(env) {
  for (const key of ["MAIL_PROVIDER", "MAIL_FROM", "MAIL_REPLY_TO", "RESEND_API_KEY"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  delete require.cache[require.resolve(mailerPath)];
  return require(mailerPath);
}

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// ── The template ───────────────────────────────────────────────────────────

test("the code leads the text part (inbox preview, OTP autofill)", () => {
  const { buildResetCodeEmail } = load({});
  const mail = buildResetCodeEmail("0427", 10);
  assert.ok(mail.text.startsWith("0427 is your Monticello Villas password reset code."));
});

test("leading zeros survive", () => {
  const { buildResetCodeEmail } = load({});
  assert.ok(buildResetCodeEmail("0042", 10).html.includes(">0042<"));
});

test("one subject for every message, never containing the code", () => {
  const { buildResetCodeEmail } = load({});
  const a = buildResetCodeEmail("1111", 10).subject;
  const b = buildResetCodeEmail("9876", 10).subject;
  assert.strictEqual(a, b);
  assert.ok(!/\d{4}/.test(a));
});

test("no links, images or remote content in either part", () => {
  const { buildResetCodeEmail } = load({});
  const { text, html } = buildResetCodeEmail("1234", 10);
  for (const part of [text, html]) {
    assert.ok(!/https?:\/\//i.test(part), "a URL");
    assert.ok(!/<img|<a\s|src=|@import|url\(/i.test(part), "remote content");
  }
});

test("carries the expiry and both security lines", () => {
  const { buildResetCodeEmail } = load({});
  const { text } = buildResetCodeEmail("1234", 10);
  assert.ok(text.includes("expires in 10 minutes"));
  assert.ok(text.includes("you can ignore this email"));
  assert.ok(text.includes("will ever ask you for this code"));
});

test("no spam-trigger phrasing", () => {
  const { buildResetCodeEmail } = load({});
  const all = Object.values(buildResetCodeEmail("1234", 10)).join(" ").toLowerCase();
  for (const phrase of ["click here", "act now", "urgent", "free", "winner", "!!!"]) {
    assert.ok(!all.includes(phrase), phrase);
  }
});

// ── The provider switch ────────────────────────────────────────────────────

test("defaults to SMTP and asks only for the SMTP secrets", () => {
  const { mailSecrets, provider } = load({});
  assert.strictEqual(provider(), "smtp");
  assert.deepStrictEqual(mailSecrets(), ["SMTP_USER", "SMTP_PASS"]);
});

test("Resend asks only for its key", () => {
  const { mailSecrets } = load({ MAIL_PROVIDER: "Resend" });
  assert.deepStrictEqual(mailSecrets(), ["RESEND_API_KEY"]);
});

test("Resend posts the message with the key and the configured sender", async () => {
  const mailer = load({
    MAIL_PROVIDER: "resend",
    MAIL_FROM: "Monticello Villas <no-reply@mail.example.com>",
    MAIL_REPLY_TO: "hoa@example.com",
    RESEND_API_KEY: "re_test",
  });
  let seen;
  global.fetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => "" };
  };
  await mailer.sendMail({ to: "ana@example.com", subject: "S", text: "T", html: "H", headers: { "X-Entity-Ref-ID": "r" } });
  assert.strictEqual(seen.url, "https://api.resend.com/emails");
  assert.strictEqual(seen.init.headers.Authorization, "Bearer re_test");
  const body = JSON.parse(seen.init.body);
  assert.deepStrictEqual(body.to, ["ana@example.com"]);
  assert.strictEqual(body.from, "Monticello Villas <no-reply@mail.example.com>");
  assert.strictEqual(body.reply_to, "hoa@example.com");
  assert.strictEqual(body.text, "T");
  assert.strictEqual(body.headers["X-Entity-Ref-ID"], "r");
});

test("a Resend rejection is an error, not a silent success", async () => {
  const mailer = load({ MAIL_PROVIDER: "resend", MAIL_FROM: "a <a@b.co>", RESEND_API_KEY: "k" });
  global.fetch = async () => ({ ok: false, status: 403, text: async () => "domain is not verified" });
  await assert.rejects(
    mailer.sendMail({ to: "x@y.co", subject: "S", text: "T", html: "H" }),
    /403.*not verified/
  );
});

test("Resend without MAIL_FROM refuses rather than guessing a sender", async () => {
  const mailer = load({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "k" });
  global.fetch = async () => ({ ok: true, status: 200, text: async () => "" });
  await assert.rejects(mailer.sendMail({ to: "x@y.co", subject: "S", text: "T", html: "H" }), /MAIL_FROM/);
});

test("an App Password pasted as Google shows it (with spaces) is sent without them", () => {
  const mailer = load({});
  const auth = mailer.smtpAuth({ SMTP_USER: " office@example.com\n", SMTP_PASS: "abcd efgh ijkl mnop\n" });
  assert.equal(auth.pass, "abcdefghijklmnop");
  assert.equal(auth.pass.length, 16);
  assert.equal(auth.user, "office@example.com");
});

test("a bare SMTP_USER with no @ is refused with the real cause, not sent to Gmail", () => {
  const mailer = load({});
  assert.throws(() => mailer.smtpAuth({ SMTP_USER: "office", SMTP_PASS: "abcdefghijklmnop" }), /full Gmail address/);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log("PASS", name);
    } catch (err) {
      failed += 1;
      console.log("FAIL", name, "-", err.message);
    }
  }
  console.log(failed ? `${failed} FAILED` : `ALL ${cases.length} PASS`);
  process.exit(failed ? 1 : 0);
})();
