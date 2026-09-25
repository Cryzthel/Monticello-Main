import { useEffect, useState } from 'react'
import EvidenceImage from '@shared/components/EvidenceImage'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// Full-resolution, full-screen media viewer shared by both portals'
// forensic views — a click on any evidence thumbnail opens this instead of
// only ever seeing the cropped/contained inline preview.
export default function Lightbox({ media = [], startIndex = 0, watermark, onClose }) {
  const [index, setIndex] = useState(startIndex)

  useEffect(() => {
    setIndex(startIndex)
  }, [startIndex])

  useEffect(() => {
    function handleKeydown(event) {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(media.length - 1, i + 1))
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [media.length, onClose])

  if (!media.length) return null
  const active = media[index]

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex flex-col bg-black/95"
      onClick={(event) => {
        // Self-contained regardless of what it's nested inside (e.g. the
        // Incident Detail Modal) — a backdrop click here should only close
        // the lightbox, never bubble up and close an ancestor modal too.
        event.stopPropagation()
        onClose?.()
      }}
    >
      <div className="flex shrink-0 items-center justify-between p-4">
        <span className="text-xs font-medium text-white/70">
          {index + 1} of {media.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-icon-sm text-white/70 hover:bg-tint/10 hover:text-text-primary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
        onClick={(event) => event.stopPropagation()}
      >
        {media.length > 1 && index > 0 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i - 1)}
            className="btn btn-icon-md absolute left-2 z-10 bg-tint/10 text-text-primary hover:bg-tint/20 sm:left-4"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : null}

        <div className="relative flex max-h-full max-w-full items-center justify-center">
          {active.type === 'video' ? (
            <video src={active.url} controls autoPlay className="max-h-[75vh] max-w-full rounded-lg object-contain" />
          ) : (
            <img
              src={active.url}
              alt="Incident evidence, full resolution"
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
            />
          )}

          {watermark ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-gradient-to-t from-black/85 to-transparent p-4">
              <p className="text-sm font-semibold text-text-primary">{watermark.name}</p>
              <p className="text-xs text-white/80">{watermark.address}</p>
              <p className="text-xs text-white/60">{watermark.timestamp}</p>
            </div>
          ) : null}
        </div>

        {media.length > 1 && index < media.length - 1 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i + 1)}
            className="btn btn-icon-md absolute right-2 z-10 bg-tint/10 text-text-primary hover:bg-tint/20 sm:right-4"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {media.length > 1 ? (
        <div
          className="custom-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 pb-4"
          onClick={(event) => event.stopPropagation()}
        >
          {media.map((item, i) => (
            <button
              key={item.url}
              type="button"
              onClick={() => setIndex(i)}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === index ? 'border-brand-500' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              {item.type === 'video' ? (
                <video src={item.url} className="h-full w-full object-cover" muted />
              ) : (
                <EvidenceImage src={item.url} />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
