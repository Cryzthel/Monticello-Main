import { useState } from 'react'
import { Download, Film, Play } from '@shared/icons'
import { formatBytes } from '@shared/lib/attachments'
import { isBrowserPlayable } from '@shared/lib/videoCompression'

const durationLabel = (sec) => {
  if (!Number.isFinite(sec)) return null
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The full-size player for one video evidence item (`mediaItemsFrom` shape).
 *
 * Native controls, deliberately: play/pause, mute, volume, scrubbing and
 * fullscreen, keyboard-accessible, in every browser, and the one player
 * nobody has to learn. What this adds around them:
 *
 *   - the poster frame, so the player shows the scene before a byte of video
 *     has loaded, and `preload="metadata"` so opening a ticket does not pull
 *     a whole clip nobody pressed play on;
 *   - `playsInline`, or iOS takes over the screen on play;
 *   - a FALLBACK for what the browser cannot decode — AVI always, and a codec
 *     a given browser lacks — with a download link, so evidence is never
 *     simply a black box that does nothing.
 */
export function EvidenceVideo({ item, className = '', autoPlay = false }) {
  const [failed, setFailed] = useState(false)
  const playable = isBrowserPlayable(item.contentType ?? '') && !failed

  if (!playable) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 rounded-lg bg-black/60 p-6 text-center ${className}`}>
        <Film size={32} className="text-white/70" aria-hidden="true" />
        <p className="text-body font-medium text-white/90">This video format cannot play in the browser.</p>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          download
          className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-small font-semibold text-white hover:bg-white/20"
        >
          <Download size="sm" aria-hidden="true" />
          Download {item.format ?? 'video'}
          {item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ''}
        </a>
      </div>
    )
  }

  return (
    <video
      key={item.url}
      src={item.url}
      poster={item.posterUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      autoPlay={autoPlay}
      onError={() => setFailed(true)}
      className={className}
    />
  )
}

/**
 * A thumbnail for one video item: the stored poster where there is one (an
 * image, so a grid of clips costs a grid of JPEGs), otherwise the clip's own
 * first frame. Always badged, so a still never passes for a photo.
 */
export function VideoThumb({ item, className = 'h-full w-full object-cover' }) {
  const duration = durationLabel(item.durationSec)
  return (
    <>
      {item.posterUrl ? (
        <img src={item.posterUrl} alt="" loading="lazy" className={className} />
      ) : isBrowserPlayable(item.contentType ?? '') ? (
        <video src={item.url} className={className} muted playsInline preload="metadata" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-black/40">
          <Film size={20} className="text-white/70" aria-hidden="true" />
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
          <Play size={12} aria-hidden="true" />
        </span>
      </span>
      {duration ? (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-small text-white">
          {duration}
        </span>
      ) : null}
    </>
  )
}
