/**
 * Client-side video evidence: format detection, compression, poster frames.
 *
 * ── WHY IN THE BROWSER, AND WHY NOT FFmpeg.wasm ─────────────────────────────
 * The same argument as imageCompression.js: a Cloud Function can only shrink
 * a file AFTER the slow, expensive part — pushing it up a guardhouse uplink —
 * has happened. So videos over COMPRESS_ABOVE_BYTES are re-encoded on the
 * device before the first byte leaves.
 *
 * FFmpeg.wasm was the obvious tool and the wrong one here: a ~30 MB core to
 * download on the slow connection this exists to spare, multi-threading only
 * behind cross-origin-isolation headers both portals would have to adopt, and
 * software encoding several times slower than real time on a laptop. The
 * browser already ships hardware H.264 encoders behind WebCodecs; mediabunny
 * (MPL-2.0, tree-shaken to the conversion path) is the demux → decode →
 * encode → MP4 plumbing around them. Where WebCodecs or the container is not
 * supported, compression reports itself unavailable and the caller uploads
 * the original if it fits — evidence is never dropped for want of a codec.
 *
 * Loaded with a dynamic import, so neither portal pays for it until a guard
 * actually picks a large clip.
 */

/** Videos at or under this go up untouched — already cheap, and every re-encode costs fidelity. */
export const COMPRESS_ABOVE_BYTES = 25 * 1024 * 1024

/**
 * Largest original a guard may pick. Compression streams the source from
 * disk, but the encoded output is held in memory until upload, so this bounds
 * the work rather than the RAM.
 */
export const MAX_SOURCE_VIDEO_BYTES = 1024 * 1024 * 1024

/**
 * Largest video that may be UPLOADED. Under the 200 MB storage.rules ceiling
 * on `incidents/{uid}/`, with room to spare. A compressed clip only lands
 * near this when it is long enough that the forensic bitrate floor wins.
 */
export const MAX_UPLOAD_VIDEO_BYTES = 150 * 1024 * 1024

/** What a compressed clip aims for, so a typical bodycam clip lands well under 25 MB. */
const TARGET_BYTES = 20 * 1024 * 1024

/**
 * Longest edge after compression. 720p keeps faces and plates legible at the
 * size every viewer in both portals actually draws a video; 1080p and 4K
 * phone footage spends most of its bytes on detail nobody can see there.
 */
const MAX_EDGE_PX = 1280

/**
 * Bitrate band. The ceiling stops a short clip from being re-encoded to a
 * bigger file than it needs; the FLOOR is the forensic-clarity guarantee —
 * below ~700 kb/s 720p motion turns to blocks, so a long clip is allowed to
 * overshoot TARGET_BYTES rather than become useless as evidence.
 */
const MAX_VIDEO_BITRATE = 2_500_000
const MIN_VIDEO_BITRATE = 700_000
const AUDIO_BITRATE = 96_000

/**
 * The formats the evidence pickers accept, by extension, with the MIME type
 * to upload them as. Extension-first because Windows reports `.mov` and
 * `.avi` with an empty `type` on some installs, and storage.rules requires a
 * `video/*` content type — an empty one is refused as `storage/unauthorized`.
 */
const VIDEO_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
}

export const VIDEO_ACCEPT = '.mp4,.mov,.webm,.avi,video/mp4,video/quicktime,video/webm,video/x-msvideo'

/** The formats a viewer can play inline: no AVI. For media residents watch (announcements). */
export const STREAMABLE_VIDEO_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm'

const extensionOf = (name = '') => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()

/** The content type to treat (and upload) this file as — the browser's own if it has one. */
export function videoContentType(file) {
  if (file?.type?.startsWith('video/')) return file.type
  return VIDEO_TYPES[extensionOf(file?.name)] ?? ''
}

export function isVideoFile(file) {
  return Boolean(videoContentType(file))
}

/** Short format label for metadata and captions: "MP4", "MOV", "AVI". */
export function videoFormatLabel(file) {
  const ext = extensionOf(file?.name)
  if (ext) return ext.toUpperCase()
  return (videoContentType(file).split('/')[1] ?? 'video').toUpperCase()
}

/**
 * AVI cannot be decoded by any browser or demuxed by mediabunny, so it is
 * accepted, stored and offered for download, but never compressed and never
 * played inline. Said here once so the uploader and the viewers agree.
 */
export function isBrowserPlayable(contentType = '') {
  return contentType !== 'video/x-msvideo'
}

export function needsCompression(file) {
  return file.size > COMPRESS_ABOVE_BYTES
}

/** Raised when this browser cannot compress this file (no encoder, unsupported container). */
export class VideoCompressionUnavailable extends Error {
  constructor(message) {
    super(message)
    this.name = 'VideoCompressionUnavailable'
  }
}

function pickBitrate(durationSec) {
  if (!durationSec || !Number.isFinite(durationSec)) return 1_500_000
  const budget = (TARGET_BYTES * 8) / durationSec - AUDIO_BITRATE
  return Math.round(Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, budget)))
}

/** Scale to fit MAX_EDGE_PX on the longest side, even dimensions, never upscale. */
function fitDimensions(width, height) {
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height))
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

/**
 * Re-encode `file` as H.264 (or the first codec this browser can encode) MP4
 * at ≤720p and a duration-derived bitrate.
 *
 * Returns `{ done, cancel }`. `done` resolves to
 * `{ file, meta: { durationSec, width, height, originalBytes, bytes, compressed: true } }`
 * and rejects with VideoCompressionUnavailable when this browser or file
 * cannot be converted, or with mediabunny's ConversionCanceledError on cancel.
 * `onProgress` receives 0–100.
 */
export function compressVideo(file, { onProgress } = {}) {
  let conversion = null
  let canceled = false

  const done = (async () => {
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
      throw new VideoCompressionUnavailable('This browser has no WebCodecs video encoder.')
    }
    const mb = await import('mediabunny')
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS })

    let track
    let durationSec
    try {
      track = await input.getPrimaryVideoTrack()
      durationSec = await input.computeDuration()
    } catch {
      throw new VideoCompressionUnavailable('This video container cannot be read in the browser.')
    }
    if (!track) throw new VideoCompressionUnavailable('No video track found.')

    const { width, height } = fitDimensions(track.displayWidth, track.displayHeight)
    const bitrate = pickBitrate(durationSec)

    let codec = null
    for (const candidate of ['avc', 'vp9', 'av1']) {
      if (await mb.canEncodeVideo(candidate, { width, height, bitrate })) {
        codec = candidate
        break
      }
    }
    if (!codec) throw new VideoCompressionUnavailable('No supported video encoder for this clip.')

    let audioCodec
    for (const candidate of ['aac', 'opus']) {
      if (await mb.canEncodeAudio(candidate, { bitrate: AUDIO_BITRATE })) {
        audioCodec = candidate
        break
      }
    }

    const output = new mb.Output({
      // `in-memory` fast start writes the index at the FRONT, so the players in
      // both portals can begin playback before the whole clip has downloaded.
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    })

    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { width, height, fit: 'contain', codec, bitrate },
      // No audio encoder: let mediabunny copy the audio as-is when it can.
      audio: audioCodec ? { codec: audioCodec, bitrate: AUDIO_BITRATE } : undefined,
    })
    if (canceled) {
      await conversion.cancel()
      throw new mb.ConversionCanceledError()
    }
    if (!conversion.isValid) {
      throw new VideoCompressionUnavailable('This clip cannot be converted in the browser.')
    }
    conversion.onProgress = (progress) => onProgress?.(Math.round(progress * 100))
    await conversion.execute()

    const buffer = output.target.buffer
    const name = file.name.replace(/\.[^.]+$/, '') + '.mp4'
    const compressed = new File([buffer], name, { type: 'video/mp4' })
    return {
      file: compressed,
      meta: {
        durationSec: Math.round(durationSec * 10) / 10,
        width,
        height,
        originalBytes: file.size,
        bytes: compressed.size,
        compressed: true,
      },
    }
  })()

  return {
    done,
    cancel: () => {
      canceled = true
      return conversion?.cancel()
    },
  }
}

/**
 * Duration and size of a clip, read by the browser's own <video> element.
 * Resolves `{ durationSec, width, height }` with nulls where the browser
 * cannot read it (AVI, a codec it lacks) — metadata is a nicety, never a gate.
 */
export function readVideoMetadata(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    const finish = (value) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => finish({ durationSec: null, width: null, height: null }), 8000)
    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = () =>
      finish({
        durationSec: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      })
    video.onerror = () => finish({ durationSec: null, width: null, height: null })
    video.src = url
  })
}

/**
 * A JPEG poster frame for the viewers' thumbnails, taken a little way in
 * (past the black first frame most phones record). Resolves null when the
 * browser cannot decode the clip — the viewers fall back to a film glyph.
 */
export function captureVideoPoster(blob, { maxEdge = 640 } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    const finish = (value) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 10000)
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.onloadeddata = () => {
      const at = Number.isFinite(video.duration) ? Math.min(1, video.duration * 0.1) : 0
      video.currentTime = at
    }
    video.onseeked = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((poster) => finish(poster), 'image/jpeg', 0.8)
      } catch {
        finish(null)
      }
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}
