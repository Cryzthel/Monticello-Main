/**
 * Client-side image downscaling and compression, shared by the Admin
 * announcement composer and the Guardhouse report composer.
 *
 * ── WHY THIS RUNS IN THE BROWSER ─────────────────────────────────────────────
 * A modern phone camera produces 12–50 MP JPEGs of 8–25 MB. Those were being
 * uploaded byte-for-byte to Cloud Storage and then pulled down again, at full
 * resolution, by every resident's phone opening the feed — the notice board is
 * the most-read screen in the mobile app. The cost lands three times: the
 * guard's upload on guardhouse wifi, the storage bill, and every reader's data
 * plan. Nothing downstream ever needed those pixels: the mobile card renders an
 * image a few hundred CSS pixels wide.
 *
 * Compressing here rather than in a Cloud Function is deliberate. A function
 * fires AFTER the upload, so the slow, expensive part — pushing 25 MB up a
 * domestic uplink — has already happened, and the original still has to be
 * stored or cleaned up. Resizing before the first byte leaves is the only
 * version that makes the upload itself fast.
 *
 * ── NO DEPENDENCY ────────────────────────────────────────────────────────────
 * `browser-image-compression` does roughly this in ~40 kB. The two things it
 * buys are a Web Worker and an EXIF-orientation shim, and both are now
 * available natively: `createImageBitmap` decodes off the main thread AND
 * applies EXIF orientation when asked, and `OffscreenCanvas` keeps the resize
 * off it too. What is left is the quality ladder below. For a
 * security-sensitive console, ~150 lines we can read beats a dependency we
 * cannot.
 */

/**
 * Longest-edge ceiling. 1920 is the web-optimised maximum from the spec, and
 * it is also the point past which nothing in either product can show the
 * difference: the mobile card is a few hundred px wide, and the portals'
 * lightbox is bounded by the viewport.
 *
 * Aspect ratio is always preserved and images are NEVER upscaled — a 640px
 * photo stays 640px rather than being interpolated up to a blurrier 1920.
 */
export const MAX_EDGE_PX = 1920

/**
 * The payload we aim for. Not a hard limit — the ladder stops as soon as it is
 * under, so a small image is left nearly untouched rather than degraded to hit
 * a number.
 */
export const TARGET_BYTES = 1_500_000

/**
 * Ceiling on the SOURCE file, before any compression.
 *
 * Deliberately generous. Photos straight off a modern phone are routinely
 * 8–25 MB, and a composer that refuses those is a composer that refuses the
 * normal case — the old announcement flow rejected anything over 5 MB and left
 * the admin to go and resize it in another application. Since we now downscale
 * in the browser, a big source file is not a problem to report, it is the
 * expected input.
 *
 * What this DOES stop is decoding something absurd. `createImageBitmap` on a
 * 200 MP TIFF allocates roughly width × height × 4 bytes of uncompressed pixel
 * data — hundreds of megabytes — before any of our code runs, and the tab dies
 * with no error we can catch or explain. This bound is about that allocation,
 * not about storage.
 */
export const MAX_SOURCE_IMAGE_BYTES = 60 * 1024 * 1024

/** Quality ladder. First rung under `targetBytes` wins. */
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.5, 0.4]

/**
 * If the lowest quality is still over target, the image is large in DIMENSIONS
 * rather than detail — a 50 MP panorama at q0.4 is still huge. Shrink and
 * retry. Two passes takes 1920px to ~1229px, which is past the point of
 * diminishing returns for a feed image.
 */
const DIMENSION_RETRY_SCALE = 0.8
const MAX_DIMENSION_RETRIES = 2

/**
 * GIF is deliberately excluded from compression.
 *
 * Canvas has no concept of animation: drawing a GIF and re-encoding it yields
 * frame one, silently. An animated GIF that arrives as a still is a worse
 * outcome than a large GIF, and there is no way to tell the difference by
 * looking at the tile afterwards. SVG is excluded because it is already
 * vector — rasterising it makes it bigger and worse.
 */
const UNCOMPRESSIBLE = new Set(['image/gif', 'image/svg+xml'])

export function isCompressibleImage(type = '') {
  return type.startsWith('image/') && !UNCOMPRESSIBLE.has(type)
}

/**
 * Formats that can carry transparency.
 *
 * Source MIME is the test rather than scanning the pixels, and the asymmetry is
 * on purpose: guessing "has alpha" when it does not costs a slightly larger
 * WebP, while guessing "opaque" when it does not turns every transparent pixel
 * BLACK on JPEG re-encode. A logo or a cropped screenshot would come out with
 * a black surround and nothing would report an error. One direction is a
 * rounding error; the other is visibly destroyed media.
 */
const ALPHA_CAPABLE = new Set(['image/png', 'image/webp', 'image/avif'])

let webpEncodeSupport = null

/**
 * Does this browser's canvas ENCODE WebP?
 *
 * Feature-detected by encoding and checking the type that came back, because
 * `toBlob` with an unsupported type does not throw — it silently hands back a
 * PNG, which for a photo is several times LARGER than the JPEG we were trying
 * to avoid. Checking the resulting MIME is the only reliable test.
 */
async function supportsWebpEncode() {
  if (webpEncodeSupport != null) return webpEncodeSupport
  try {
    const probe = createCanvas(1, 1)
    // The context is REQUIRED, not decorative: an OffscreenCanvas that has
    // never had one is in "no context mode", and convertToBlob on it throws
    // InvalidStateError. That throw was being caught below and read as "this
    // browser cannot encode WebP" — so every alpha-bearing PNG silently took
    // the JPEG path, on browsers that support WebP perfectly well.
    probe.getContext('2d')
    const blob = await canvasToBlob(probe, 'image/webp', 0.5)
    webpEncodeSupport = blob?.type === 'image/webp'
  } catch {
    webpEncodeSupport = false
  }
  return webpEncodeSupport
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function canvasToBlob(canvas, type, quality) {
  // OffscreenCanvas exposes convertToBlob; HTMLCanvasElement exposes toBlob.
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encode failed'))), type, quality)
  })
}

/**
 * Decode to a bitmap, with EXIF orientation applied.
 *
 * `imageOrientation: 'from-image'` is the load-bearing option. Without it a
 * photo taken in portrait on a phone — which is stored landscape plus an EXIF
 * rotation flag — is drawn to the canvas sideways, and re-encoding BAKES that
 * in: the rotation flag is gone from the output, so the image is now
 * permanently rotated rather than merely tagged. Every portrait photo from a
 * phone would arrive on its side.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Older Safari rejects the options bag rather than ignoring it.
      try {
        return await createImageBitmap(file)
      } catch {
        /* fall through to the <img> path */
      }
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not decode this image.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function fittedSize(width, height, maxEdge) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scaled: false }
  const ratio = maxEdge / longest
  return {
    // `max(1, …)` guards a pathological aspect ratio (a 4000×1 strip) from
    // rounding its short edge to zero, which makes the canvas throw.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  }
}

function renameFor(name, mime) {
  const ext = mime === 'image/webp' ? 'webp' : 'jpg'
  const stem = name.replace(/\.[^./\\]+$/, '') || 'image'
  return `${stem}.${ext}`
}

/**
 * Downscale and re-encode `file`, returning a new File plus what happened.
 *
 * Never throws for image reasons the caller can do nothing about: an
 * undecodable file resolves with the ORIGINAL and `skipped: 'undecodable'`, so
 * the caller can still try the upload and let Storage rules be the judge. The
 * one thing this must never do is silently drop a guard's evidence because a
 * canvas call failed.
 *
 * @param {File} file
 * @param {{maxEdge?: number, targetBytes?: number}} [options]
 * @returns {Promise<{file: File, meta: object}>}
 */
export async function compressImage(file, options = {}) {
  const maxEdge = options.maxEdge ?? MAX_EDGE_PX
  const targetBytes = options.targetBytes ?? TARGET_BYTES

  const base = {
    originalBytes: file.size,
    bytes: file.size,
    originalType: file.type,
    type: file.type,
  }

  if (!isCompressibleImage(file.type)) {
    return { file, meta: { ...base, skipped: 'unsupported-format' } }
  }

  let bitmap
  try {
    bitmap = await decode(file)
  } catch {
    return { file, meta: { ...base, skipped: 'undecodable' } }
  }

  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height

  try {
    const fitted = fittedSize(sourceWidth, sourceHeight, maxEdge)

    // Already small in both senses: re-encoding would spend quality to make it
    // marginally smaller, or make it BIGGER, for a file that was never a
    // problem. Leave it exactly as the operator supplied it.
    if (!fitted.scaled && file.size <= targetBytes) {
      return {
        file,
        meta: {
          ...base,
          width: sourceWidth,
          height: sourceHeight,
          originalWidth: sourceWidth,
          originalHeight: sourceHeight,
          skipped: 'already-optimal',
        },
      }
    }

    const wantsAlpha = ALPHA_CAPABLE.has(file.type)
    const webpOk = await supportsWebpEncode()
    // WebP where we can: it carries alpha AND beats JPEG on size. JPEG is the
    // fallback, and for an alpha-capable source on a browser without WebP
    // encoding we fill white first so transparency flattens to white rather
    // than to JPEG's default black.
    const mime = webpOk ? 'image/webp' : 'image/jpeg'
    const flatten = wantsAlpha && mime === 'image/jpeg'

    let width = fitted.width
    let height = fitted.height
    let best = null

    for (let attempt = 0; attempt <= MAX_DIMENSION_RETRIES; attempt += 1) {
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return { file, meta: { ...base, skipped: 'no-canvas-context' } }

      // Best-quality downsampling. Chrome's default is already good; stating it
      // keeps Firefox and Safari from using a cheaper filter, which shows as
      // aliasing on the fine detail of a downscaled document photo.
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'

      if (flatten) {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, width, height)
      }
      ctx.drawImage(bitmap, 0, 0, width, height)

      for (const quality of QUALITY_STEPS) {
        // eslint-disable-next-line no-await-in-loop -- the ladder is inherently
        // sequential: each rung exists only because the previous was too big.
        const blob = await canvasToBlob(canvas, mime, quality)
        if (!best || blob.size < best.blob.size) best = { blob, quality, width, height }
        if (blob.size <= targetBytes) {
          best = { blob, quality, width, height }
          break
        }
      }

      if (best && best.blob.size <= targetBytes) break

      const next = fittedSize(width, height, Math.round(Math.max(width, height) * DIMENSION_RETRY_SCALE))
      width = next.width
      height = next.height
    }

    if (!best) return { file, meta: { ...base, skipped: 'encode-failed' } }

    // Re-encoding can LOSE: a small, already-optimised JPEG rewritten as WebP
    // sometimes comes out larger. Keep whichever is actually smaller, unless
    // the original also breached the dimension ceiling — in that case the
    // resize is the point and a few extra bytes are worth it.
    if (best.blob.size >= file.size && !fitted.scaled) {
      return {
        file,
        meta: {
          ...base,
          width: sourceWidth,
          height: sourceHeight,
          originalWidth: sourceWidth,
          originalHeight: sourceHeight,
          skipped: 'no-gain',
        },
      }
    }

    const out = new File([best.blob], renameFor(file.name, best.blob.type), {
      type: best.blob.type,
      lastModified: Date.now(),
    })

    return {
      file: out,
      meta: {
        originalBytes: file.size,
        bytes: out.size,
        originalType: file.type,
        type: out.type,
        originalWidth: sourceWidth,
        originalHeight: sourceHeight,
        width: best.width,
        height: best.height,
        quality: best.quality,
        resized: best.width !== sourceWidth || best.height !== sourceHeight,
        // Guard against a divide-by-zero on a 0-byte file rather than
        // rendering "Infinity% smaller" in the UI.
        savedRatio: file.size > 0 ? 1 - out.size / file.size : 0,
      },
    }
  } finally {
    // ImageBitmap holds decoded pixels — up to 200 MB for a 50 MP photo — until
    // it is closed or garbage collected. Ten of those queued in a composer is
    // an out-of-memory tab, so release each one as soon as its canvas work is
    // done rather than waiting for GC.
    bitmap.close?.()
  }
}

/** "8.4 MB → 940 KB", for the tile caption. */
export function describeCompression(meta) {
  if (!meta || meta.skipped) return null
  const pct = Math.round(meta.savedRatio * 100)
  if (pct < 5) return null
  return `${pct}% smaller`
}
