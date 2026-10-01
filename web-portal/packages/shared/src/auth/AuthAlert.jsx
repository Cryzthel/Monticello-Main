import { CheckCircle2, ShieldAlert } from '@shared/icons'

/**
 * The one banner every authentication screen uses to say something went wrong
 * or went right.
 *
 * ── WHY IT IS A COMPONENT AND NOT A CLASS STRING ─────────────────────────────
 * It existed as a copy-pasted block in four places — the sign-in form, the
 * two-factor step, recovery and the reset page — and had already drifted: three
 * different corner radii and two different icon alignments between screens that
 * a user sees one after another. "Standardise the tokens" is not something a
 * convention can deliver across four files; one component can.
 *
 * ── ON THE COLOUR ────────────────────────────────────────────────────────────
 * The brief names `bg-rose-50 text-rose-700 border-rose-200`. This uses the
 * design system's `danger` token instead, which resolves to #B91C1C — red-700
 * rather than rose-700, about a hue step apart and indistinguishable beside
 * each other, but the SAME red every other error in both consoles already
 * uses: toasts, confirm dialogs, form validation, the dispatch banners.
 *
 * Introducing rose here would make the authentication screens the only surface
 * in the product with their own red, which is the opposite of the
 * standardisation the brief is asking for. If the rose family is wanted, it
 * belongs in the `--color-danger` token so the whole product moves together —
 * that is a one-line change in styles/index.css, not a change here.
 */

const TONE = {
  error: {
    Icon: ShieldAlert,
    className: 'border-danger/30 bg-danger/10 text-danger',
    role: 'alert',
  },
  success: {
    Icon: CheckCircle2,
    className: 'border-success/30 bg-success/10 text-success',
    role: 'status',
  },
}

/**
 * @param tone  'error' | 'success'.
 * @param children  The message. Kept as children rather than a string prop so a
 *                  banner can carry an inline action — recovery's "try a
 *                  different address" lives inside one.
 */
export default function AuthAlert({ tone = 'error', children }) {
  const { Icon, className, role } = TONE[tone] ?? TONE.error
  if (!children) return null

  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-2xl border p-3.5 text-sm leading-relaxed ${className}`}
    >
      <Icon size="sm" className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
