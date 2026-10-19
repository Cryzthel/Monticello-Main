# Go-live runbook — 2026-10-20

Everything between "the data is purged" and "the portals are live". Steps marked
**you** need your Google, Firebase or Vercel login; everything else is done or
scripted.

## 1. State (verified 2026-10-20)

- Branch `web-portal-and-dispatch` at `d25b3b2` (purge ordering fix, `backups/` ignored).
- Firebase Auth: one account, `adminmonticellov@gmail.com` (super_admin, approved).
- Realtime Database: empty. Firestore: the admin's documents plus `system_settings` and `operations_state`. Storage: the admin's 7 files.
- `scripts/serviceAccountKey.json` and the Downloads copy: deleted.

## 2. Revoke the leaked service-account key — **you**

The key `28c2066d077ff091706ed8125d3ca84c55defdab` was pasted into a chat
transcript. Deleting the local files does not stop it working; only revoking does.

1. Open <https://console.cloud.google.com/iam-admin/serviceaccounts?project=monticello-villas-f600e>.
2. Click **firebase-adminsdk-fbsvc@monticello-villas-f600e.iam.gserviceaccount.com**.
3. Open the **Keys** tab.
4. Find the key whose ID starts **28c2066d** → **⋮** → **Delete** → confirm.
5. Check **IAM & Admin → Audit logs** (or Logs Explorer, filter `protoPayload.authenticationInfo.principalEmail="firebase-adminsdk-fbsvc@…"`) for any use of that key you did not make.

For future admin scripts, create a fresh key, use it, and delete it the same day.

## 3. The local backup — recommendation: destroy it

`backups/pre-launch-2026-10-20/` (14 MB) holds `auth-users.json` (16 accounts
with password hashes), partial Firestore and Storage copies, all of it test data.
It is git-ignored but **OneDrive is syncing it**.

Recommended — the data was test data and the purge was intended:

```powershell
Remove-Item -Recurse -Force "C:\Users\Lian's laptop\OneDrive\Desktop\Monticello-Main\backups\pre-launch-2026-10-20"
```

Then empty it from **both** recycle bins: Windows Recycle Bin, and OneDrive on
the web → **Recycle bin** → select → **Delete** (OneDrive otherwise keeps it for 30 days,
then the second-stage bin for longer).

If you must keep it instead: move it **out of OneDrive**, then encrypt it, e.g. 7-Zip
→ Add to archive → **AES-256**, **Encrypt file names**, a strong passphrase you store in
a password manager — then delete the unencrypted folder as above.

## 4. Create the guard accounts — **you** (Admin portal)

Every guard login was removed by the purge. For each guard:

1. Sign in to the Admin portal as `adminmonticellov@gmail.com` → **Security accounts**.
2. **Create security account** (super_admin only).
3. *Guard details*: full name, a unique **Badge ID** (e.g. `MV-0142`), contact number.
4. *System credentials*: the guard's **real** email. A temporary password is generated; copy it.
5. Create. The confirmation shows the credentials **once** — hand them over in person.
6. The guard signs in to the Guardhouse and must set their own password at first sign-in.

Use each guard's own address (not shared or test addresses): it is where their password-reset code goes.

## 5. Open items from SECURITY_AUDIT.md

| Item | Action |
|------|--------|
| Firestore backups / PITR / delete protection | Scripted below (billed; small at this size). |
| Android release signing | **You** — keystore steps below. Do not publish a build signed with the debug key. |
| App Check | **You** (console) — steps below; needs a code change to register, then enforcement. |
| API key & Mapbox token restrictions | **You** — after the Vercel domains exist (step 6). |
| Security headers | Done in `apps/*/vercel.json` (CSP in report-only first). |

**Backups** (run once, Firebase CLI logged in as owner):

```bash
npx firebase-tools firestore:databases:update "(default)" --delete-protection ENABLED --point-in-time-recovery ENABLED --project monticello-villas-f600e
npx firebase-tools firestore:backups:schedules:create --recurrence DAILY --retention 14d --project monticello-villas-f600e
```

**Release signing:**

```bash
keytool -genkey -v -keystore %USERPROFILE%\monticello-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Keep the `.jks` and its passwords **outside** the repo and backed up (a lost upload key
means a support request to Google). Add `android/key.properties` (git-ignored) with
`storePassword`, `keyPassword`, `keyAlias=upload`, `storeFile=<path>`, point
`buildTypes.release.signingConfig` at it, enable Play App Signing, and build with
`flutter build appbundle --obfuscate --split-debug-info=build/symbols`.

**App Check:** Firebase Console → App Check → register the Android app (Play Integrity),
iOS (App Attest) and each portal domain (reCAPTCHA Enterprise). The apps then need the
App Check SDK initialised (a code change). Leave enforcement **off** and watch the
metrics for a week; enforce on Firestore, Storage and Functions once legitimate traffic
shows as verified.

## 6. Vercel production deploy

Two Vercel projects, both from the GitHub repo `Cryzthel/Monticello-Main`:

| | Admin | Guardhouse |
|---|---|---|
| Root Directory | `web-portal/apps/admin-portal` | `web-portal/apps/security-portal` |
| Framework / build | from `vercel.json` (Vite, `npm ci` at `web-portal/`, `vite build`, `dist`) | same |
| "Include files outside the root directory" | **On** (the boundary GeoJSON lives at the repo root) | **On** |
| Production branch | the branch you release from (local `web-portal-and-dispatch` is 10 commits ahead of GitHub — push first) | same |

**Environment variables** (Production, both projects — values from `web-portal/.env.local`):

| Variable | Notes |
|---|---|
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_DATABASE_URL` | public client config |
| `VITE_MAPBOX_TOKEN` | the `pk.` token; restrict it to the two Vercel domains |
| `VITE_AUTH_RETURN_ORIGINS` | comma-separated: both portals' production origins (lets the reset page return to the right console) |
| `VITE_GUARDHOUSE_LNGLAT` | Guardhouse only, if set locally |
| `VITE_SPONSOR_FEED_URL` | Admin only, optional |

No server secrets go to Vercel: both portals are static sites that talk to Firebase
directly. **CORS:** callable Functions answer any origin by design (auth is checked
in the function); the portals read Storage through `<img>`/download URLs, so no bucket
CORS change is needed.

**After the first deploy — you:**
1. Google Cloud → Credentials → the **Browser key** → HTTP referrers: both Vercel domains (+ `localhost:3000`, `localhost:3001` for development).
2. Mapbox → Tokens → the `pk.` token → URL restrictions: the same domains.
3. Open both portals, sign in as the admin, check the browser console for CSP reports; when clean for a few days, rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in both `vercel.json`.
