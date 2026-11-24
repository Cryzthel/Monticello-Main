import { categoryColor, categoryLabel, normalizeCategory } from '@shared/lib/incidentCategories'
import { categoryIcon } from '@shared/theme/categoryIcons'

/**
 * The category as an icon tile, in the category's own colour — the same
 * colour the category charts use, so a medical call reads rose in both
 * places.
 *
 * Shared because both consoles' incident panels now lead with it. The Admin
 * inspection rail used to open on a bare title, so the two panels described
 * the same call with a different first fixation: the Guardhouse answered
 * "what kind of call is this" in the glyph before the heading was read, and
 * the Admin console answered it three groups down the card in a plain
 * sentence.
 */
export default function CategoryIconBadge({ category, className = '' }) {
  const key = normalizeCategory(category)
  const Icon = categoryIcon(key)
  const color = categoryColor(key)
  return (
    <span
      title={categoryLabel(key)}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${className}`}
      style={{ backgroundColor: `${color}1f`, color, '--tw-ring-color': `${color}55` }}
    >
      <Icon size="md" aria-hidden="true" />
    </span>
  )
}
