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

**Live since 2026-10-20:** <https://monticello-admin.vercel.app> and
<https://monticello-guardhouse.vercel.app> (Vercel team `cryzthels-projects`,
projects `monticello-admin` / `monticello-guardhouse`, deployed with the CLI from
the repo root; `.vercelignore` limits the upload to `web-portal/` and `assets/geo/`).
`VITE_AUTH_RETURN_ORIGINS` is set to both origins. The CSP allows each portal's
inline theme script by SHA-256 hash — if `index.html`'s inline script changes, the
browser console prints the new hash; update `vercel.json` with it.

Note: Vercel's Hobby plan is for personal, non-commercial use; a subdivision's
production console may need the Pro plan.

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

## 7. Android app releases (direct APK, no Play Store)

Residents and staff install the app from a link, not the Play Store:

- **Public page:** `/download` on either portal (<https://monticello-admin.vercel.app/download>). It is not linked from the login screens (removed 2026-10-20 — the consoles are staff-only); share the link or the QR instead. It shows the current version, date, size and SHA-256, a QR code for scanning from a computer, and a plain-language install guide.
- **Permanent link:** <https://monticello-villas-f600e.web.app/downloads/monticello-release.apk> — always the newest build (each release overwrites it). This is the URL for flyers and printed QR codes. In the portals it is `APK_DOWNLOAD_URL` (`@shared/lib/appDownload`); render a code with `<QrCode value={APK_DOWNLOAD_URL} label="…" size={240} />` (`@shared/components/QrCode`).
- **Files:** Firebase Hosting, `https://monticello-villas-f600e.web.app/downloads/` — the permanent `monticello-release.apk`, the versioned `monticello-v<version>-release.apk` (kept for every release), its `.sha256`, and `latest.json` (the manifest the page reads). The site root is a small standalone download page too.
- **Headers** (`firebase.json` → `hosting`): APKs are served as `application/vnd.android.package-archive` with `Content-Disposition: attachment` (always a download, never binary text), `nosniff`, and year-long immutable caching for the versioned files; the permanent `monticello-release.apk` is `no-cache` so it never serves an old build. `latest.json` is `no-cache` with CORS open so the portals always see the newest release.

**One-time setup — you:**
1. Create the upload keystore (keep it and its passwords in a password manager — a lost key means existing installs can never be updated):
   `keytool -genkeypair -v -keystore "%USERPROFILE%\monticello-upload.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
2. Create `android/key.properties` (git-ignored):
   ```
   storeFile=C:/Users/<you>/monticello-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```

**Each release:**
1. Bump `version:` in `pubspec.yaml` — name **and** build number (`1.0.0+1` → `1.0.1+2`). Phones refuse an update whose build number does not increase.
2. `bash scripts/deploy-apk.sh --no-deploy` — builds with R8 shrinking and Dart obfuscation, refuses a debug-signed APK, writes the checksum and manifest. Check the output.
3. `bash scripts/deploy-apk.sh` — the same, then `firebase deploy --only hosting`. The download page updates immediately.
4. Keep `release-symbols/<version>/` (git-ignored): it is what turns an obfuscated crash trace back into readable code.

**App ID:** `com.monticello_villas_app` (changed from `com.example.monticello_villas_app` on 2026-10-20, before the first public release; registered in Firebase as Android app `1:787092385070:android:c218efb8f23f7da1ea9ebf`). The old `com.example` registration can be deleted in the Firebase console once no test devices use it.

**Upload key (created 2026-10-20):** `C:\Users\Lian's laptop\monticello-release\monticello-upload.jks` (outside OneDrive), alias `upload`, RSA 4096, valid 10,000 days. SHA-256 certificate fingerprint `01:50:A6:27:A3:CC:44:58:22:43:D2:11:83:D3:F2:3B:7B:9B:AC:A6:45:0B:C5:BA:60:3D:A3:78:94:6F:F9:35` — register it for App Check (Play Integrity). Its password is in `android/key.properties`: copy the keystore **and** that password into your password manager or an offline backup now. Lose either, and installed copies can never be updated.
