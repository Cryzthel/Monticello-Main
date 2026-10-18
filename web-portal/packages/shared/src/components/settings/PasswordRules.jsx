import { Check } from '@shared/icons'
import { RULES } from '@shared/auth/passwordPolicy'

/**
 * The password rules as a compact two-column checklist. Same rules, order and
 * words as the resident app (passwordPolicy.js). Shape carries the state — a
 * tick when met, a dot when not — and colour only reinforces it (WCAG 1.4.1).
 * `failed` turns unmet rules red after a submit was refused.
 */
export default function PasswordRules({ value, failed = false }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5" aria-label="Password requirements">
      {RULES.map((rule) => {
        const met = rule.test(value)
        const tone = met ? 'text-success' : failed ? 'text-danger' : 'text-text-muted'
        return (
          <li key={rule.id} className={`flex items-center gap-1.5 text-2xs transition-colors duration-150 ${tone}`}>
            {met ? (
              <Check size="sm" aria-hidden="true" className="h-3 w-3 shrink-0" />
            ) : (
              <span aria-hidden="true" className="mx-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
            )}
            <span className="sr-only">{met ? 'Met:' : 'Not met:'}</span>
            {rule.label}
          </li>
        )
      })}
    </ul>
  )
}
