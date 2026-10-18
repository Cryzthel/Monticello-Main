import { BADGE_TONES } from '@shared/theme/badgeStyles'

/**
 * The oblong tag the Hazard Map's modals use for status, category, priority
 * and signal: `rounded-full px-3 py-1 text-xs font-semibold`, coloured from the
 * same tone table as every StatusBadge in both consoles.
 *
 * Distinct from StatusBadge (fixed heights for table rows) because these sit
 * in modal headers and data grids, where the user's reference asked for this
 * exact padding and type. `size="sm"` is the one-step-down variant for a tag
 * inline beside a name.
 *
 * @param {object} props
 * @param {string} [props.tone]      A BADGE_TONES key.
 * @param {React.ComponentType} [props.icon]
 * @param {boolean} [props.pulse]    A pulsing dot, for live/critical states.
 * @param {'md'|'sm'} [props.size]
 */
export default function Pill({ tone = 'neutral', icon: Icon = null, pulse = false, size = 'md', className = '', children }) {
  const sizing = size === 'sm' ? 'gap-1 px-2.5 py-0.5 text-[11px]' : 'gap-1.5 px-3 py-1 text-xs'
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold tracking-wide ring-1 ring-inset ${sizing} ${
        BADGE_TONES[tone] ?? BADGE_TONES.neutral
      } ${className}`}
    >
      {Icon ? <Icon size={size === 'sm' ? 12 : 14} aria-hidden="true" /> : null}
      {pulse ? (
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      ) : null}
      {children}
    </span>
  )
}
