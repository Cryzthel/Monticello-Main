import StatusBadge from '@shared/components/StatusBadge'

/**
 * Category tag, tinted by the incident's severity.
 *
 * Kept as a named component because "category tag" is the vocabulary the
 * tables and drawers use, but it is now a thin alias over the shared oblong
 * pill — the severity -> tone map lives in StatusBadge.jsx, and the hex
 * equivalents Mapbox needs live in shared/theme/severityColors.js.
 */
export default function PriorityBadge({ severity = 'medium', size = 'md', icon, children }) {
  return (
    <StatusBadge severity={severity} size={size} icon={icon}>
      {children}
    </StatusBadge>
  )
}
