# Reset-code email: getting it into the inbox

The password-reset code is sent by `sendPasswordOtp` through
[`mailer.js`](./mailer.js). Today it goes out over the estate's Gmail account
(`MAIL_PROVIDER=smtp`). That works, but Gmail sending to Gmail from a personal
account is the setup most likely to land in Spam or Promotions, and nothing can
be done about it from `gmail.com`, because you can't add DNS records to a
domain you don't own.

The fix is a sending domain you control, authenticated with SPF, DKIM and
DMARC, and sent through Resend.

> **No setup can *guarantee* the primary inbox.** Gmail decides. Aligned
> authentication on your own domain, the plain template in `mailer.js` (no
> links, no images, a real text part, a fixed subject) and a low complaint rate
> make it very likely. Those are what this guide sets up.

## Before you start

- **A domain.** Any registrar works. You'll add DNS records to it, so you need
  access to its DNS settings.
- **Billing on the Firebase project.** The function can't run on the Spark plan
  whichever mail service you use.

## 1. Create the Resend account and add the domain

1. Sign up at resend.com and open **Domains → Add domain**.
2. Use a **subdomain** for sending, such as `mail.your-domain.com`. This keeps
   the reputation of transactional mail separate from your main domain's mail.
3. Resend shows the DNS records to add. Copy them **exactly** from that page;
   they're specific to your account. Expect these:

| Purpose | Type | Host (example)                      | Value                          |
| ------- | ---- | ----------------------------------- | ------------------------------ |
| SPF     | TXT  | `send.mail.your-domain.com`         | as shown by Resend (`v=spf1 …`) |
| SPF     | MX   | `send.mail.your-domain.com`         | as shown by Resend             |
| DKIM    | TXT  | `resend._domainkey.mail.your-domain.com` | the long public key Resend shows |

4. Add **DMARC** yourself. Resend doesn't create it, and Gmail requires it of
   bulk senders and favours it for everyone:

| Type | Host                     | Value                                                     |
| ---- | ------------------------ | --------------------------------------------------------- |
| TXT  | `_dmarc.your-domain.com` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@your-domain.com` |

   Start at `p=none` so a mistake only produces reports, not lost mail. After a
   couple of weeks of clean reports, change it to `p=quarantine`.

5. Wait for Resend to show the domain as **Verified**. DNS can take from
   minutes to a few hours.

## 2. Give the function the key

```bash
firebase functions:secrets:set RESEND_API_KEY
```

Paste the API key from Resend → **API Keys** when prompted. Use a key with
**Sending access** only, restricted to this domain.

## 3. Switch the provider

Create `functions/.env` from [`.env.example`](./.env.example):

```
MAIL_PROVIDER=resend
MAIL_FROM=Monticello Villas <no-reply@mail.your-domain.com>
MAIL_REPLY_TO=hoa-office@your-domain.com
```

## 4. Deploy and check

```bash
firebase deploy --only functions:sendPasswordOtp,functions:verifyPasswordOtp,functions:createStaffAccount
```

Then request a code for your own Gmail address. In the message, open
**⋮ → Show original** and confirm all three read **PASS**:

- `SPF: PASS`
- `DKIM: PASS` (signed by your domain, not `resend.dev`)
- `DMARC: PASS`

If any of them fails, the DNS record for that line is wrong. Fix it before
real residents rely on the code.

## Rolling back

Set `MAIL_PROVIDER=smtp` and deploy again. The Gmail secrets (`SMTP_USER`,
`SMTP_PASS`) are still in Secret Manager.

## Tests

```bash
cd functions && npm test
```

`scripts/mailer.test.cjs` pins the template (code first, no links or images,
fixed subject, security lines) and the provider switch, without sending
anything.
