import { statusStyle } from '@shared/theme/statusStyles'
import {
  BADGE_ICON_SIZES,
  BADGE_SIZES,
  BADGE_TONES,
  SEVERITY_TONES,
} from '@shared/theme/badgeStyles'

/**
 * The portal's ONE oblong badge.
 *
 * Before this, five surfaces each drew their own pill: PriorityBadge (category
 * tags), StatusControl's inline badge, IncidentHistoryCard's private
 * StatusBadge, AdminHistoryPage's CategoryChip, and the announcement type
 * chip. They used four different type sizes (10/11/12px), three paddings, and
 * two different vertical rhythms — so a Category tag and a Status tag sitting
 * in adjacent table cells were visibly different objects.
 *
 * Everything now renders through here, which makes the pill a design *rule*
 * rather than a per-file decision:
 *
 *   • `rounded-full` always — an oblong capsule at every size, never a
 *     rectangle. (This line said `rounded-lg` long after the Soft Modernism
 *     pass changed the code to `rounded-full`; the code was right.)
 *
 *     The full radius is also what distinguishes a STATE from a CONTROL in
 *     these consoles: capsules are read, `rounded-lg` fields are operated. In
 *     the Admin portal, where incident and SOS status is read-only, that
 *     distinction is the entire affordance — the pill carries no hover state
 *     and no chevron, so nothing invites a press that would be refused.
 *   • Fixed heights (not py-*), so badges of different label lengths and
 *     different variants line up on a shared baseline inside a table row.
 *   • One fill / ring / label triplet per tone (shared/theme/badgeStyles.js).
 *   • Tone is resolved from meaning (status / severity), never passed as a
 *     colour by the caller — that is how "Dispatched" stays the same blue on
 *     every screen.
 *
 * Usage:
 *   <StatusBadge status="Dispatched" />                  // status pill + icon
 *   <StatusBadge severity="high">Forced Entry</StatusBadge> // category tag
 *   <StatusBadge tone="brand" icon={Pin}>Pinned</StatusBadge>
 *   <StatusBadge as="button" tone="neutral" onClick={…}>All</StatusBadge>
 */

export default function StatusBadge({
  /** Display status ("Pending", "Dispatched", …). Resolves tone + icon. */
  status,
  /** Incident severity ("critical" | "high" | "medium" | "low"). */
  severity,
  /** Explicit tone key — wins over `severity`/`status`. */
  tone,
  /** Lucide component to render leading. Overrides the auto status icon. */
  icon,
  /** Auto status icon. Defaults on for `status`, off everywhere else. */
  withIcon,
  /** Leading 6px dot instead of an icon — for dense rows where icons crowd. */
  dot = false,
  size = 'md',
  as: Component = 'span',
  className = '',
  children,
  ...rest
}) {
  const resolvedTone =
    tone ?? (severity ? SEVERITY_TONES[severity] : undefined) ?? (status ? statusStyle(status).tone : undefined)

  const toneClass = BADGE_TONES[resolvedTone] ?? BADGE_TONES.neutral
  const sizeClass = BADGE_SIZES[size] ?? BADGE_SIZES.md
  const iconClass = BADGE_ICON_SIZES[size] ?? BADGE_ICON_SIZES.md

  const showIcon = withIcon ?? (Boolean(icon) || Boolean(status))
  const Icon = icon ?? (status ? statusStyle(status).icon : null)

  // Falling back to the raw severity word ("critical") needs the capitalize;
  // an explicit label is rendered exactly as the caller wrote it.
  const label = children ?? status ?? severity ?? 'Unknown'
  const capitalize = children == null && !status && severity ? 'capitalize' : ''

  // Every pill sets in Inter, medium weight. Status labels were JetBrains Mono
  // until the 2026-09-22 redesign; the reference's capsules are the UI face,
  // and a mono label read as costume beside the sans figures around it.

  const interactive =
    Component === 'button'
      ? 'cursor-pointer transition-[filter] duration-150 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50'
      : ''

  return (
    <Component
      className={`inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-full font-medium leading-none ring-1 ring-inset ${sizeClass} ${toneClass} ${capitalize} ${interactive} ${className}`}
      {...rest}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {!dot && showIcon && Icon ? <Icon className={`${iconClass} shrink-0`} /> : null}
      {label}
    </Component>
  )
}
