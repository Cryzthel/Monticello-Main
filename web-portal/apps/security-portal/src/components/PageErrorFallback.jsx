import { RotateCcw, ShieldAlert } from 'lucide-react'
import Card from '@shared/components/Card'

/**
 * What a page renders instead of its content when its ErrorBoundary catches.
 *
 * Sized to sit INSIDE the dashboard shell, so the sidebar and top bar survive
 * the crash — on a phone the drawer is the only navigation there is, and a
 * full-bleed error screen would leave the user with a dead end and the back
 * button. `min-h-11` on the retry control because this is the one thing on
 * screen worth tapping and it is frequently the first thing a thumb reaches for.
 */
export default function PageErrorFallback({ error, reset, title = 'This page failed to load.' }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger/10 text-danger">
        <ShieldAlert className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        {error?.message ? (
          <p className="mx-auto mt-1 max-w-sm break-words text-xs leading-relaxed text-text-secondary">
            {error.message}
          </p>
        ) : null}
      </div>
      {reset ? (
        <button type="button" onClick={reset} className="btn btn-sm btn-outline min-h-11 px-4">
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      ) : null}
    </Card>
  )
}
