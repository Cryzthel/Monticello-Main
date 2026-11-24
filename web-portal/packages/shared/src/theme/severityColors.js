// Single source of truth for incident-severity colors. Mapbox paint
// properties need raw hex/rgba (not Tailwind classes), so this can't be
// merged into index.css's @theme block — keep these hex values in sync with
// the success/warning/danger/severity-high tokens in src/styles/index.css
// and the classes in shared/components/PriorityBadge.jsx.
export const SEVERITY_HEX = {
  critical: '#F2545C',
  high: '#FB923C',
  medium: '#FBBF24',
  low: '#22C55E',
}
