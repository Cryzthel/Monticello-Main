# Pre-launch security audit — 2026-10-20

Scope: resident mobile app (Flutter), Guardhouse and Admin portals (React/Vite),
Firestore / Storage / Realtime Database rules, Cloud Functions.
Out of scope by request: payments, AI prompt injection, password hashing.

**Status legend:** ✅ fixed in code · 🟡 fixed and **deployed 2026-10-20** (rules + `sendPasswordOtp`, `verifyPasswordOtp`, `confirmEmailChange`) · 🔧 needs a console/ops action · ℹ️ checked, no issue

## Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | **Critical** | Residents could self-verify (create/update own `residents` record as verified) | 🟡 rules |
| 2 | **High** | Reset-code guess limit bypassable with parallel requests | 🟡 functions |
| 3 | **High** | Any signed-in account could read/list every resident's incident photos & videos | 🟡 storage rules |
| 4 | **High** | Android release builds signed with the debug key | 🔧 signing |
| 5 | **High** | No database backups, PITR or delete protection | 🔧 ops |
| 6 | Medium | Reporter could write admin fields on own incident (`deletedAt`, `reporterUid`…) and delete live calls | 🟡 rules |
| 7 | Medium | Government ID scans readable by security officers | 🟡 storage rules |
| 8 | Medium | Guards could backdate shift clock-in / clock-out | 🟡 rules |
| 9 | Medium | No App Check; no per-caller throttle on the public reset endpoint | 🟡 throttle · 🔧 App Check |
| 10 | Medium | Android app-data backup enabled (session + cached data) | ✅ manifest |
| 11 | Medium | No security headers configured for the portals | 🔧 hosting |
| 12 | Low | SVG accepted as an "image" upload | 🟡 storage rules |
| 13 | Low | Resident-supplied URLs rendered as links in Admin | ✅ allowlist |
| 14 | Low | Unescaped addresses in the "email changed" notice HTML | ✅ escaped |
| 15 | Low | 4-digit reset code; registered-email disclosure (estate decisions) | ℹ️ documented |
| 16 | Info | Mapbox public token in a local, never-pushed Git commit | 🔧 restrict token |

## Phase 1

### 1. Secrets & API keys ℹ️
- No private keys, service-account JSON, SMTP/Resend credentials or `sk.` tokens are tracked or in Git history (pattern scan of all commits, including deleted files).
- Web bundles receive only `VITE_FIREBASE_*` (public client config) and a **public** Mapbox `pk.` token. Mail credentials live in Secret Manager (`functions/mailer.js`).
- `google-services.json` / `GoogleService-Info.plist` hold public client config — acceptable, but **restrict the API keys** (see actions).
- `.env.local`, `functions/.env`, `dart_defines.json`, `*serviceAccountKey*.json` are git-ignored.
- **#16:** the mobile Mapbox token appears in commit `c4260e1` (2026-10-14). That commit exists only in local agent checkpoint refs — it is on no branch and was never pushed. Restrict the token (below); rotate if this repository was ever copied elsewhere.

### 2. Database rules
- Firestore ends in a default-deny catch-all; Storage and RTDB default-deny too. No `if true` rules.
- **#1 (Critical) self-verification.** `residents/{uid}` create was `isOwner || isAdminStaff` with no field checks, and owner updates compared only `verificationStatus` while `isVerifiedResident()` also accepts the legacy `status`. A new account could write `verificationStatus: 'verified'` (or `status: 'verified'`) and pass the gate on SOS and incident reports. **Fix:** owner records must be created pending with no review fields; owner updates may not move the derived state, `verificationStatus`, `status`, or any review field.
- **#6.** Reporter updates are now limited to `hasMedia`, `photoUrls`, `videoUrls` and the one-time `residentRating` (all the app writes). Reporter deletes only on closed reports (matching `Incident.isDeletable`).
- **#8.** `guard_shifts` `timeIn`/`timeOut` must equal server time (the console already writes `serverTimestamp()`).
- Previously hardened this cycle: dispatch optimistic lock, arrival-before-resolve, SOS state machine, presence reads.

### 3. Server-side auth & ownership ℹ️
Every callable checks `context.auth` server-side. Staff callables re-read `staff_accounts/{uid}` (approved + role); provisioning requires `super_admin`; email change requires a fresh re-auth (`auth_time`) and sends the code to the new address with a notice to the old one. Triggers run with the Admin SDK on server data only.

### 4. Injection ℹ️
No SQL at runtime (the `db/` SQL files are models only). All data access uses the Firestore SDKs with structured queries; no string-built queries, `eval`, or `new Function`.

### 5. Rate limiting & billing
- **#2 (High).** `verifyPasswordOtp` read the attempt count, compared, then incremented in three steps — parallel guesses all saw "under 5". **Fix:** one Firestore transaction per guess + constant-time compare. Verified in the emulators: 12 parallel wrong guesses → exactly 5 counted, 7 refused, and the correct code is then locked out.
- **#9.** `sendPasswordOtp` now allows 20 requests per IP per hour (transactional counter keyed by a hashed IP, server-only collection, 24 h TTL field `purgeAt`).
- Not in code: App Check, budget alerts — see actions.

## Phase 2

### Storage & uploads
- **#3 / #7 / #12.** Evidence: uploader + staff only (was any signed-in user, including list). IDs: uploader + admin roles only. SVG refused everywhere an image is accepted. Existing: per-folder owner writes, type allowlist, size caps (200 MB evidence, 10 MB IDs/avatars, 5 MB announcements). Files are served by Google Cloud Storage and never executed.
- Note: stored download URLs carry their own token; files are as private as the documents holding the URLs (now restricted above).

### Mass assignment & sessions
- `staff_accounts` is not client-writable (roles only via callables). `users/{uid}` is owner-writable but nothing server-side trusts its fields except `fcmToken` (by design).
- Web sessions: Firebase Auth keeps tokens in IndexedDB (no httpOnly cookie option for a Firebase SPA). The mitigations are XSS prevention (no raw-HTML sinks found; React escaping; #13 URL allowlist) and a CSP (#11).

### XSS
No `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML` or Mapbox `setHTML` in either portal; map popups build DOM with `textContent`. **#13:** links built from resident-supplied evidence/ID URLs now pass `safeHttpUrl` (http/https only). **#14:** addresses in the email-change notice are HTML-escaped.

### Mobile
- Token storage ℹ️: the app stores no passwords or tokens itself — only a remembered email in SharedPreferences; the offline SOS queue is in `flutter_secure_storage` (Keychain/KeyStore). Firebase Auth manages its own session.
- Deep links ℹ️: no intent filters or URL schemes are registered (only outbound `tel:`, `sms:`, `https` queries).
- Biometrics ℹ️: not implemented (an unused `biometricLogin` profile flag exists); all sensitive actions are enforced by rules/functions.
- **#10 ✅** `android:allowBackup="false"`.
- **#4 🔧** release signing uses the debug keystore — see actions.

### Deployment & ops
- Source maps: not emitted (Vite default); production builds strip dev code. Functions return fixed, generic error messages (no stack traces).
- **#11 🔧** no hosting config is in the repo, so headers must be set where the portals are hosted (template below).
- **#5 🔧** backups (below).

## Actions that need you (console / ops)

1. ~~Deploy rules and functions~~ — **done 2026-10-20**; a live `verifyPasswordOtp` call returned the expected response with no errors logged.
2. **Android signing (#4):** create an upload keystore (`keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`), add `android/key.properties` (git-ignored), and point `buildTypes.release.signingConfig` at it. Enable Play App Signing. Build releases with `--obfuscate --split-debug-info=build/symbols`.
3. **Backups (#5):** `firebase firestore:databases:update "(default)" --delete-protection ENABLED --point-in-time-recovery ENABLED`, and a schedule: `firebase firestore:backups:schedules:create --recurrence DAILY --retention 14d`. (PITR and backups are billed.)
4. **App Check (#9):** enable App Check (Play Integrity / App Attest for mobile, reCAPTCHA Enterprise for the portals), monitor, then enforce on Firestore, Storage and Functions.
5. **Billing:** Cloud Billing → Budgets & alerts, e.g. alerts at 50/90/100 % of a monthly cap.
6. **API key restrictions:** in Google Cloud → Credentials, restrict the Android key to the package + SHA-1, the iOS key to the bundle ID, and the browser key to the portal domains; restrict each to the Firebase APIs it uses. Restrict both Mapbox tokens to their URLs / app IDs (#16).
7. **TTL policies:** `gcloud firestore fields ttls update purgeAt --collection-group=password_reset_otps --enable-ttl` and the same for `password_reset_ip_throttle`.
8. **Security headers (#11)** on the portal host:
   ```
   Strict-Transport-Security: max-age=31536000; includeSubDomains
   X-Frame-Options: DENY
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=(self)
   Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://firebasestorage.googleapis.com https://*.mapbox.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://*.cloudfunctions.net https://*.mapbox.com https://events.mapbox.com; worker-src 'self' blob:; frame-ancestors 'none'
   ```
   Roll the CSP out as `Content-Security-Policy-Report-Only` first and watch the console for blocked sources.

## Verification
- Emulator rule tests: 33 new checks (residents, incidents, shifts, Storage) plus the 43 existing dispatch/SOS/presence checks — all pass.
- Emulator function test: parallel OTP guessing held at 5 attempts.
- Functions unit tests, both portal builds, security-portal tests: pass. `safeHttpUrl`: 9/9 cases.
- Not verified on a device: the Android manifest change and the release-signing steps.
