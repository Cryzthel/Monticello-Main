import { formatBytes, uploadIncidentAttachment } from '@shared/lib/attachments'
import {
  MAX_SOURCE_VIDEO_BYTES,
  MAX_UPLOAD_VIDEO_BYTES,
  VideoCompressionUnavailable,
  captureVideoPoster,
  compressVideo,
  isBrowserPlayable,
  needsCompression,
  readVideoMetadata,
  videoContentType,
  videoFormatLabel,
} from '@shared/lib/videoCompression'

/**
 * One video, from the guard's disk to a URL plus its metadata — the pipeline
 * every evidence picker shares (File a Report, Resolve incident, Resolve SOS),
 * so the three cannot disagree about limits, compression or what is stored.
 *
 *   picked ─► size gate ─► compress if > 25 MB ─► chunked upload ─► poster upload
 *
 * `onUpdate` receives `{ status, progress, note?, preview? }`:
 *   status 'compressing' — re-encoding on this device, progress 0–100
 *   status 'uploading'   — resumable transfer, progress 0–100
 *   preview              — a local blob: URL of the poster, as soon as one exists
 *   note                 — what happened to the file, for the tile caption
 *
 * Returns `{ done, cancel }`. `done` resolves `{ url, meta }` where `meta` is
 * the record written next to the URL on the document (see `videoMeta`):
 *   { url, posterUrl, format, contentType, sizeBytes, originalSizeBytes,
 *     durationSec, width, height, compressed }
 * It rejects with an Error whose message is ready to show, or with a
 * `storage/canceled` / ConversionCanceledError on `cancel()`.
 *
 * The caller owns the returned preview URL and revokes it.
 */
export function uploadVideoEvidence(source, { onUpdate } = {}) {
  let canceled = false
  let stopCompression = null
  let uploadTask = null

  const cancelError = () => Object.assign(new Error('Upload cancelled.'), { code: 'storage/canceled' })

  const done = (async () => {
    const contentType = videoContentType(source)
    if (source.size > MAX_SOURCE_VIDEO_BYTES) {
      throw new Error(`This video is too large (${formatBytes(source.size)}). Trim the clip and try again.`)
    }

    const playable = isBrowserPlayable(contentType)

    // The poster comes from the ORIGINAL, straight away, so the tile has a
    // picture during what can be a minute of compression.
    const posterBlob = playable ? await captureVideoPoster(source) : null
    if (canceled) throw cancelError()
    if (posterBlob) onUpdate?.({ preview: URL.createObjectURL(posterBlob) })

    let file = source
    let meta = null
    let note = null
    if (playable && needsCompression(source)) {
      onUpdate?.({ status: 'compressing', progress: 0 })
      const job = compressVideo(source, { onProgress: (progress) => onUpdate?.({ status: 'compressing', progress }) })
      stopCompression = job.cancel
      try {
        const result = await job.done
        file = result.file
        meta = result.meta
        const saved = Math.round((1 - file.size / source.size) * 100)
        note = saved > 0 ? `${saved}% smaller` : 'compressed'
      } catch (err) {
        if (canceled) throw cancelError()
        // Compression is an optimisation, never a gate: the original goes up
        // if it fits under the upload ceiling below.
        if (!(err instanceof VideoCompressionUnavailable)) console.warn('Video compression failed', err)
        note = 'not compressed on this browser'
      } finally {
        stopCompression = null
      }
    }
    if (canceled) throw cancelError()

    if (file.size > MAX_UPLOAD_VIDEO_BYTES) {
      throw new Error('This video is too long to upload. Trim the clip and try again.')
    }

    if (!meta) {
      const read = playable ? await readVideoMetadata(file) : { durationSec: null, width: null, height: null }
      meta = { ...read, originalBytes: source.size, bytes: file.size, compressed: false }
    }

    onUpdate?.({ status: 'uploading', progress: 0, note })
    const uploadType = meta.compressed ? 'video/mp4' : contentType
    const { task, done: uploaded } = uploadIncidentAttachment(
      file,
      (progress) => onUpdate?.({ status: 'uploading', progress }),
      { contentType: uploadType },
    )
    uploadTask = task
    if (canceled) task.cancel()
    const url = await uploaded
    uploadTask = null

    // The poster is a convenience for the viewers: a failure here costs a
    // thumbnail, never the evidence, so it is swallowed.
    let posterUrl = null
    if (posterBlob && !canceled) {
      try {
        const poster = uploadIncidentAttachment(posterBlob, null, {
          contentType: 'image/jpeg',
          name: `${file.name.replace(/\.[^.]+$/, '')}-poster.jpg`,
        })
        uploadTask = poster.task
        posterUrl = await poster.done
      } catch {
        posterUrl = null
      } finally {
        uploadTask = null
      }
    }

    return {
      url,
      note,
      meta: {
        url,
        posterUrl,
        format: meta.compressed ? 'MP4' : videoFormatLabel(source),
        contentType: uploadType,
        sizeBytes: meta.bytes,
        originalSizeBytes: meta.originalBytes,
        durationSec: meta.durationSec ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        compressed: meta.compressed,
      },
    }
  })()

  return {
    done,
    cancel: () => {
      canceled = true
      stopCompression?.()
      uploadTask?.cancel?.()
    },
  }
}
