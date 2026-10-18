import { Eye, EyeOff } from '@shared/icons'

/** The eye inside the New password field; it reveals all three at once. */
export default function RevealToggle({ on, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={on ? 'Hide passwords' : 'Show passwords'}
      aria-pressed={on}
      className="rounded-lg p-2 text-text-muted transition-colors duration-150 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      {on ? <EyeOff size="sm" /> : <Eye size="sm" />}
    </button>
  )
}
