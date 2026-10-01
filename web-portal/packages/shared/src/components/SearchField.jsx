import { Search, X } from '@shared/icons'

/**
 * The one search input, for every filter bar in both portals.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * There were fifteen of these, hand-rolled, and they had drifted into four
 * different controls: two radii (`rounded-lg` and `rounded-xl`), two fills
 * (`bg-slate-50` and `bg-base-800`), two borders (`border-slate-200` and
 * `border-hairline`), focus rings on some and not others, and the iOS
 * zoom guard on exactly one of them. Two of those four appeared in the same
 * portal one page apart.
 *
 * A search box is the most repeated control in the console, so it is the one
 * that can least afford to be re-typed per screen. Everything about its shape
 * is decided here.
 *
 * ── THE OBLONG ─────────────────────────────────────────────────────────────
 *
 * `rounded-full`, which the Capsule-Is-Read-Not-Pressed rule otherwise
 * reserves for things you read rather than operate. The carve-out is
 * deliberate and narrow — see DESIGN.md — and it is survivable here for the
 * reason it is NOT survivable on a textarea: the radius resolves to half of a
 * FIXED 36px height, and the leading icon sits at `px-4`, so the curve is
 * nowhere near the first glyph of text. The textarea safety net in
 * styles/index.css is untouched and still forbids the multi-line case that
 * actually broke.
 *
 * ── THE DETAILS THAT ARE EASY TO LOSE ──────────────────────────────────────
 *
 * `h-11 sm:h-9` with `text-base sm:text-sm`: iOS zooms the viewport on focus
 * for any field under 16px and never zooms back out, so the phone size is
 * 16px type in a 44px touch target and the desktop size is the 36px toolbar
 * baseline every filter bar aligns on. Exactly one of the fifteen had this;
 * now all of them do.
 *
 * `focus-within` on the WRAPPER, not `focus` on the input: the border and ring
 * belong to the oblong, and the input inside it is transparent and
 * outline-none. The focus treatment is the house emerald one `.field` uses
 * rather than a slate ring, so a focused search matches every other focused
 * control in the console.
 *
 * `type="text"` with `inputMode="search"`, not `type="search"`: the latter
 * paints a native clear affordance that differs per browser and sits outside
 * this component's control, which is the drift this file exists to end.
 */
export default function SearchField({
  value,
  onChange,
  placeholder,
  /**
   * Pass a handler to get a clear button once there is something to clear.
   *
   * Opt-in rather than automatic: it needs to reset whatever state the caller
   * is driving, and a field that renders the affordance without being able to
   * act on it is worse than one that never offers it. `pr-1.5` trims the
   * oblong's right padding when it is shown, so the 32px tap target sits
   * inside the curve rather than pushing against it.
   */
  onClear,
  /** Extra classes for the oblong itself — sizing and flex behaviour. */
  className = '',
  ...rest
}) {
  const clearable = Boolean(onClear) && Boolean(value)
  return (
    <div
      className={`flex h-11 min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-field pl-4 transition-[border-color,box-shadow] duration-150 hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 sm:h-9 ${clearable ? 'pr-1.5' : 'pr-4'} ${className}`}
    >
      <Search size="sm" className="shrink-0 text-text-secondary" aria-hidden="true" />
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="h-full w-full min-w-0 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-sm"
        {...rest}
      />
      {clearable ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="icon-btn icon-btn-plain h-8 w-8 shrink-0"
        >
          <X size="sm" />
        </button>
      ) : null}
    </div>
  )
}
