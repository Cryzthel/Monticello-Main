import { useCallback, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Skeleton } from '@shared/components/Skeleton'

/**
 * One incident-evidence image, with the load handled.
 *
 * WHAT WAS WRONG. Evidence was rendered as a bare `<img src>` in three places
 * (the guard History card, the Admin detail modal, the Lightbox). A bare img
 * has zero height until its bytes arrive, so opening a report collapsed the
 * media frame to nothing, then snapped it open when the photo landed —
 * a visible stall plus a layout jump, on the one screen where an operator is
 * trying to identify what happened.
 *
 * Three things fix it:
 *
 *  1. The BOX is owned by the caller and never depends on the image. This
 *     component fills its parent absolutely, so the frame is at its final
 *     size before a single byte is requested. No layout shift is possible.
 *  2. A skeleton occupies that box while loading, so the frame reads as
 *     "arriving" rather than "empty".
 *  3. `img.complete` is checked synchronously in a ref callback. A prefetched
 *     image is already decoded, and waiting for React's `onLoad` to fire on
 *     the next tick would flash the skeleton for a frame on a cache hit —
 *     which is exactly the case prefetching exists to make instant.
 *
 * `decoding="async"` and `loading="lazy"` keep a long thumbnail strip off the
 * main thread; the active/hero image opts out of lazy with `eager`.
 */
export default function EvidenceImage({
  src,
  alt = '',
  fit = 'cover',
  eager = false,
  className = '',
}) {
  const [state, setState] = useState('loading')

  // Ref callback rather than useEffect: this runs during commit, before the
  // browser paints, so a cached image never shows the skeleton at all.
  const measure = useCallback((node) => {
    if (!node) return
    if (node.complete) setState(node.naturalWidth > 0 ? 'loaded' : 'error')
  }, [])

  if (!src) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-tint/[0.03]">
        <ImageOff className="h-5 w-5 text-text-muted" />
      </div>
    )
  }

  return (
    <>
      {state === 'loading' ? (
        <Skeleton variant="muted" className="absolute inset-0 rounded-none" />
      ) : null}

      {state === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-tint/[0.03]">
          <ImageOff className="h-5 w-5 text-text-muted" />
          <p className="text-2xs text-text-muted">Evidence unavailable</p>
        </div>
      ) : null}

      <img
        ref={measure}
        src={src}
        alt={alt}
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
          fit === 'contain' ? 'object-contain' : 'object-cover'
        } ${state === 'loaded' ? 'opacity-100' : 'opacity-0'} ${className}`}
      />
    </>
  )
}
