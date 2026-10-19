/**
 * Where the Android app is published (Firebase Hosting, by
 * scripts/deploy-apk.sh). Overridable for a staging site with
 * VITE_APP_DOWNLOAD_BASE.
 */
export const DOWNLOAD_BASE = (import.meta.env.VITE_APP_DOWNLOAD_BASE || 'https://monticello-villas-f600e.web.app/downloads').replace(/\/$/, '')

/**
 * The permanent APK link. Every release overwrites the file behind it, so the
 * URL never changes — print it, or a QR code of it, on flyers once and it
 * keeps pointing at the newest build:
 *
 *   <QrCode value={APK_DOWNLOAD_URL} label="Download the Monticello Villas app" />
 */
export const APK_DOWNLOAD_URL = `${DOWNLOAD_BASE}/monticello-release.apk`

/** The release manifest (version, size, SHA-256) the download page reads. */
export const RELEASE_MANIFEST_URL = `${DOWNLOAD_BASE}/latest.json`
