/**
 * One live status tile: a judged dot, a label, a value and its threshold.
 *
 * -- WHY A THRESHOLD IS PART OF THE COMPONENT ------------------------------
 * "12 open" tells an administrator nothing without knowing whether 12 is
 * normal. Every indicator therefore states what it is being judged against in
 * the `detail` slot, and the dot encodes the verdict so a row of four is
 * scannable without reading any of the values. A tile that cannot say what
 * good looks like is a number, not a status.
 *
 * -- WHY IT LIVES IN shared/ -----------------------------------------------
 * It was a private function inside the admin MetricsPanel, which meant the
 * Overview could not show the same reading without a second implementation of
 * the same tile — and a system-health strip that renders differently on two
 * pages is the exact drift this pass exists to remove.
 *
 * @param {'ok'|'warn'|'bad'|'idle'} state Drives the dot, the value colour and
 *   whether the dot pulses. Anything unrecognised reads as `idle` (grey, no
 *   pulse) rather than as healthy — an unknown state is not good news.
 */

const TONES = {
  ok: { dot: 'bg-success', text: 'text-success' },
  warn: { dot: 'bg-warning', text: 'text-warning' },
  bad: { dot: 'bg-danger', text: 'text-danger' },
  idle: { dot: 'bg-text-muted', text: 'text-text-secondary' },
}

export default function StatusIndicator({ label, value, state = 'idle', detail }) {
  const tone = TONES[state] ?? TONES.idle

  return (
    <div
      className="card flex items-center gap-3 p-4"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {/* The pulse is reserved for states that want attention. A permanently
            animating row of four teaches an operator to ignore the animation,
            which costs the one case it was added for. */}
        {state === 'warn' || state === 'bad' ? (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.dot}`} />
        ) : null}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone.dot}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-text-muted">{label}</p>
        <p className={`mt-0.5 truncate font-mono text-sm font-semibold tabular-nums ${tone.text}`}>
          {value}
        </p>
      </div>
      {detail ? <p className="shrink-0 text-caption text-text-muted">{detail}</p> : null}
    </div>
  )
}
