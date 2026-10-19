import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Calendar, Check, Copy, Download, Info, Loader2, ShieldCheck, Smartphone, X } from '@shared/icons'
import { useDialogFocus } from '@shared/hooks/useDialogFocus'
import { APK_DOWNLOAD_URL, RELEASE_MANIFEST_URL } from '@shared/lib/appDownload'
import QrCode from '@shared/components/QrCode'

/** `{ status: 'loading' | 'ready' | 'none' | 'error', release }` */
function useLatestRelease() {
  const [state, setState] = useState({ status: 'loading', release: null })
  useEffect(() => {
    const controller = new AbortController()
    fetch(RELEASE_MANIFEST_URL, { cache: 'no-cache', signal: controller.signal })
      .then((res) => {
        if (res.status === 404) return null
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then((release) => setState({ status: release ? 'ready' : 'none', release }))
      .catch((err) => {
        if (err.name !== 'AbortError') setState({ status: 'error', release: null })
      })
    return () => controller.abort()
  }, [])
  return state
}

function formatSize(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatDate(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Copy-to-clipboard for the checksum, with a brief confirmation. */
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1500)
        })
      }}
      aria-label={copied ? 'Copied' : label}
      className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors duration-150 hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  )
}

/**
 * Plain-language steps for installing an app from outside the Play Store.
 * Android asks once, per browser, for permission to "install unknown apps";
 * the wording below matches what the phone shows.
 */
function InstallGuide({ open, onClose, release }) {
  const panelRef = useRef(null)
  useDialogFocus({ open, containerRef: panelRef })
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  const steps = [
    { title: 'Download the file', body: 'Tap “Download Android APK”. When it finishes, tap the notification (or open it from your Downloads).' },
    { title: 'Allow your browser to install apps', body: 'If Android says installs from this source are blocked, tap Settings and turn on “Allow from this source”. Then go back.' },
    { title: 'Install', body: 'Tap Install. If Google Play Protect asks to scan the app, choose Scan — it is safe to continue.' },
    { title: 'Turn the permission off again', body: 'Optional, but tidy: Settings → Apps → your browser → Install unknown apps → off. The app stays installed.' },
  ]

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div className="dialog-scrim absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} role="presentation" />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
        className="dialog-panel relative w-full max-w-md rounded-2xl border border-hairline bg-base-900 p-5 shadow-modal"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close installation help"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <X size={18} />
        </button>
        <h2 id="install-guide-title" className="pr-8 text-base font-semibold text-text-primary">
          Installing the app on Android
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          This app is installed directly instead of from the Play Store. It takes about a minute.
        </p>
        <ol className="mt-4 space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-600 dark:text-brand-400">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-text-primary">{step.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-text-secondary">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-hairline bg-base-950/60 p-3 text-xs leading-relaxed text-text-secondary">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          <span>
            Only install the app from this page. Updates must come from the same source — a copy from anywhere else will
            not install over this one.
            {release?.sha256 ? ' The SHA-256 checksum below lets you confirm the file is exactly the one published.' : ''}
          </span>
        </p>
        <button type="button" onClick={onClose} className="btn btn-action btn-brand mt-4 w-full">
          Got it
        </button>
      </section>
    </div>
  )
}

/**
 * DIRECT DOWNLOAD CARD — the Android app, from Firebase Hosting, without the
 * Play Store (2026-10-20, by request).
 *
 *   ┌ [phone] Monticello Villas for Android           ┌───────┐ ┐
 *   │ (v1.0.0) (Oct 20, 2026) (48.2 MB) (Android 5+)  │  QR   │ │
 *   │ [ Download Android APK ]                        └───────┘ │
 *   │ How to install ·  SHA-256 9f2c…  [copy]                   │
 *   └───────────────────────────────────────────────────────────┘
 *
 * The QR encodes the permanent APK_DOWNLOAD_URL, so scanning it with a phone
 * starts the download directly, and a printed copy never goes stale. Everything shown comes from latest.json, written by
 * scripts/deploy-apk.sh alongside the APK.
 */
export default function DirectDownloadCard() {
  const { status, release } = useLatestRelease()
  const [guideOpen, setGuideOpen] = useState(false)

  return (
    <section
      aria-label="Download the Android app"
      className="w-full max-w-2xl rounded-2xl border border-hairline bg-base-900 p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
              <Smartphone size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-text-primary">Monticello Villas for Android</h2>
              <p className="text-sm text-text-secondary">Report incidents, raise an SOS and follow updates.</p>
            </div>
          </div>

          {status === 'loading' ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-text-muted" role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Checking for the latest release…
            </p>
          ) : null}

          {status === 'none' || status === 'error' ? (
            <p className="mt-5 flex items-start gap-2 rounded-xl border border-hairline bg-base-950/60 p-3 text-sm text-text-secondary" role="status">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              {status === 'none'
                ? 'No Android release has been published yet.'
                : 'The release information could not be loaded. Check your connection and refresh.'}
            </p>
          ) : null}

          {status === 'ready' ? (
            <>
              <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Release details">
                {[
                  { text: `v${release.version}`, strong: true },
                  { text: formatDate(release.releasedAt), icon: Calendar },
                  { text: formatSize(release.sizeBytes) },
                  { text: `Android ${release.minAndroid}+` },
                ]
                  .filter((pill) => pill.text)
                  .map((pill) => (
                    <li
                      key={pill.text}
                      className={`inline-flex items-center gap-1 rounded-full border border-hairline px-2.5 py-0.5 text-xs tabular-nums ${
                        pill.strong ? 'font-semibold text-text-primary' : 'text-text-secondary'
                      }`}
                    >
                      {pill.icon ? <pill.icon size={12} aria-hidden="true" /> : null}
                      {pill.text}
                    </li>
                  ))}
              </ul>

              <a
                href={release.url}
                download={release.fileName}
                className="btn btn-action btn-brand mt-5 w-full sm:w-auto"
              >
                <Download size={16} aria-hidden="true" />
                Download Android APK
              </a>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-400"
                >
                  <Info size={14} aria-hidden="true" />
                  How to install
                </button>
                <span className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
                  <span className="font-mono">SHA-256</span>
                  <span className="truncate font-mono" title={release.sha256}>
                    {release.sha256.slice(0, 12)}…
                  </span>
                  <CopyButton text={release.sha256} label="Copy the SHA-256 checksum" />
                </span>
              </div>
            </>
          ) : null}
        </div>

        {status === 'ready' ? (
          // Hidden on a phone: the QR is for handing the download from a
          // computer's screen to a phone, and a phone cannot scan itself.
          <figure className="hidden shrink-0 flex-col items-center gap-2 sm:flex sm:self-start">
            <div className="rounded-xl border border-hairline bg-white p-2">
              <QrCode value={APK_DOWNLOAD_URL} label="QR code: download the Monticello Villas Android app" />
            </div>
            <figcaption className="max-w-[11rem] text-center text-xs text-text-muted">
              On a computer? Scan with your phone&rsquo;s camera to download.
            </figcaption>
          </figure>
        ) : null}
      </div>

      <InstallGuide open={guideOpen} onClose={() => setGuideOpen(false)} release={release} />
    </section>
  )
}
