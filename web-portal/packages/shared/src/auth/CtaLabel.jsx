import { Loader2 } from '@shared/icons'

/**
 * What goes inside every primary auth button: the label, or a spinner and the
 * busy label while the request is in flight.
 *
 * Sign-in had a spinner and recovery did not — "Send code" just swapped its
 * words for "Sending…", so the button that waits on an email round trip was the
 * one with the least sign that anything was happening. One component means
 * every step waits the same way. The spinner is `aria-hidden`; the busy label
 * carries the state for a screen reader.
 */
export default function CtaLabel({ busy, label, busyLabel }) {
  if (!busy) return label
  return (
    <>
      <Loader2 size="sm" className="animate-spin" aria-hidden="true" />
      {busyLabel}
    </>
  )
}
