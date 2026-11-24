import { useEffect } from 'react'
import { buildMediaItems } from '@shared/lib/incidents'

// Module-level, not per-hook: the same report is listed on several surfaces
// (History, the tickets queue, the dispatch map's selection), and each mount
// would otherwise re-warm URLs the browser already holds.
const warmed = new Set()

/**
 * Warm the browser cache with the FIRST evidence image of each listed report.
 *
 * The stall this removes is not network latency on one image — it is that the
 * request only STARTS when the operator clicks. By the time the detail drawer
 * has mounted and rendered, the fetch has barely begun, so the frame sits
 * empty for the whole round trip.
 *
 * Warming on list render moves that round trip into idle time before the
 * click, so the drawer opens against a decoded image and `img.complete` is
 * already true (see EvidenceImage).
 *
 * Deliberately only the first item per report, and only the first `limit`
 * reports: the point is to make the OPENING instant, not to download the whole
 * archive. The remaining thumbnails load lazily once the drawer is open, by
 * which time the operator is looking at the hero image.
 *
 * `requestIdleCallback` keeps this off the critical path — evidence prefetch
 * must never compete with the incident list itself rendering.
 */
export function useEvidencePrefetch(incidents = [], { limit = 24 } = {}) {
  useEffect(() => {
    if (!incidents.length) return undefined

    const urls = []
    for (const incident of incidents.slice(0, limit)) {
      const first = buildMediaItems(incident)[0]
      // Videos are skipped: preloading one means fetching a media container we
      // would then have to decide how much of to buffer, and the thumbnail
      // strip shows a poster frame either way.
      if (first?.type === 'image' && first.url && !warmed.has(first.url)) {
        urls.push(first.url)
        warmed.add(first.url)
      }
    }
    if (!urls.length) return undefined

    const schedule = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200))
    const cancel = window.cancelIdleCallback ?? clearTimeout

    const handle = schedule(() => {
      urls.forEach((url) => {
        const img = new Image()
        // If the fetch fails, drop it from `warmed` so a later mount retries
        // rather than permanently believing it is cached.
        img.onerror = () => warmed.delete(url)
        img.src = url
      })
    })

    return () => cancel(handle)
  }, [incidents, limit])
}

export default useEvidencePrefetch
