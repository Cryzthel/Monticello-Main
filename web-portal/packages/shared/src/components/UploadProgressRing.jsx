const SIZE = 44
const STROKE = 3.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const TONES = {
  brand: 'stroke-brand-400',
  info: 'stroke-info',
}

/**
 * The upload progress mark: a ring that fills with the real percentage, the
 * number in its centre, over a soft halo that breathes while work is going on.
 *
 * `indeterminate` is for work that reports no percentage (resizing a photo):
 * a quarter arc turns instead, and no number is shown, because one would have
 * to be invented. Motion is never the only signal — the tile caption says the
 * same thing in words, and the global reduced-motion rule stills the halo and
 * the spin.
 *
 * The arc moves by `stroke-dashoffset` on a short ease-out, so progress ticks
 * glide rather than jump, and nothing here changes size: the tile never shifts.
 */
export default function UploadProgressRing({ value = 0, indeterminate = false, tone = 'brand', label = 'Upload progress' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const offset = indeterminate ? CIRCUMFERENCE * 0.75 : CIRCUMFERENCE * (1 - pct / 100)

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className="relative flex items-center justify-center"
      style={{ width: SIZE, height: SIZE }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-white/15 animate-[ring-breathe_1.8s_ease-in-out_infinite]"
      />
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        className={`relative -rotate-90 ${indeterminate ? 'animate-[spin_0.9s_linear_infinite]' : ''}`}
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-white/25" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={`${TONES[tone] ?? TONES.brand} transition-[stroke-dashoffset] duration-300 ease-[var(--ease-out-strong)]`}
        />
      </svg>
      {indeterminate ? null : (
        <span className="absolute font-mono text-small font-semibold tabular-nums text-white">{pct}%</span>
      )}
    </span>
  )
}
