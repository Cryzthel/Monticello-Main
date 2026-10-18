/**
 * An oblong text field whose label starts inside it and rises onto the top
 * border when the field is focused or filled.
 *
 * ── THE CAPSULE IS A DELIBERATE, SCOPED EXCEPTION ────────────────────────────
 * Rule 4 of the design system is explicit that "text inputs stay rectangular on
 * purpose — a stadium-shaped field is the one capsule that reads as consumer
 * rather than console", and that rule still holds for every field inside either
 * dashboard. This component exists only on the sign-in screens, which are the
 * threshold rather than the console: two fields, no data, nothing to scan. It
 * is not exported for general use and nothing in an authenticated view imports
 * it.
 *
 * ── HOW THE LABEL FLOATS, AND WHY IT IS NOT PURE CSS ─────────────────────────
 * The usual trick is `peer-placeholder-shown`, which needs no JavaScript. It is
 * not used here for one reason: the label must also stay floated when the field
 * is FILLED BUT NOT FOCUSED, and `:placeholder-shown` answers that only if the
 * input carries a placeholder it can hide behind. These fields carry real,
 * useful placeholders ("Enter your email address"), so the
 * state is read from the value instead — which the form already tracks — and
 * the focused half comes from `group-focus-within`. CSS for the part CSS knows,
 * a prop for the part it does not.
 *
 * The placeholder is therefore transparent at rest, so it does not sit under
 * the resting label, and fades in on focus once the label has moved out of the
 * way. That is the Material behaviour, and it is why the placeholder is still
 * worth having.
 *
 * ── THE NOTCH ────────────────────────────────────────────────────────────────
 * The floated label paints `bg-white` behind itself to cut the border it sits
 * on. That is correct ONLY because the form pane behind these fields is white
 * in both portals. If this is ever placed on the canvas grey, the label needs
 * the surface colour it is actually on, or it draws a white smear across a grey
 * panel.
 */

/*
 * ── ONE LEFT EDGE ────────────────────────────────────────────────────────────
 * There is no leading icon any more, so the typed text, the resting label and
 * the floated label's GLYPHS all start at the well's 24px (`px-6`) inset. The
 * floated label sits at `left-4` only because its `px-2` notch padding is
 * part of its box: 16 + 8 lands its first letter on the same 24px as the text.
 * Floating then moves the label straight up, not up-and-sideways.
 */

/** Floated: sitting on the top border, small, in heading ink. */
/* ── ONE LABEL COLOUR ONCE THE LABEL HAS FLOATED (2026-10-18) ────────────────
   The floated label was brand green while the field had focus and near-black
   once the person tabbed away with a value in it, so it changed colour under
   them as they filled the form. Focused or filled, a floated label is now the
   same brand green: emerald-600, #059669. The auth screens are always on a
   white card, so one fixed value is right in both themes. */
const FLOATED_TONE = 'text-[#059669]'

const FLOATED =
  `-top-2.5 left-4 translate-y-0 bg-white px-2 text-xs font-medium ${FLOATED_TONE}`

/** Resting: inside the field, vertically centred, on the text's left edge. */
const RESTING = 'top-1/2 left-6 -translate-y-1/2 px-0 text-sm text-text-muted'

/**
 * The same values as FLOATED, applied while anything inside the wrapper has
 * focus. Spelled out rather than generated so the class strings stay literal
 * and Tailwind can see them.
 */
const FLOATED_ON_FOCUS = [
  'group-focus-within:-top-2.5',
  'group-focus-within:left-4',
  'group-focus-within:translate-y-0',
  'group-focus-within:bg-white',
  'group-focus-within:px-2',
  'group-focus-within:text-xs',
  'group-focus-within:font-medium',
  'group-focus-within:text-[#059669]',
].join(' ')

/**
 * @param filled    Whether the field has a value. Keeps the label up once the
 *                  user has typed and moved on — see the note above.
 * There is deliberately no `icon` prop. Leading glyphs (an envelope, a
 * padlock) restated the label beside it, so they were removed from every auth
 * field at once rather than left as an option one screen might take up again.
 *
 * @param trailing  Optional control at the right edge, e.g. a reveal toggle.
 */
export default function FloatingField({
  id,
  label,
  trailing,
  filled = false,
  /** A validation message for THIS field. Shown under it, and wired to the
   *  input with `aria-describedby` so a screen reader reads the field and its
   *  problem together rather than announcing an error that floats free of it. */
  error = '',
  inputClassName = '',
  ...inputProps
}) {
  return (
    <div className="group relative">
      {/* Focus lands on the WELL, not the input, so the border, the ring and
          any trailing control light up as one control.

          `border-slate-200/80` at rest, near-black on focus: the same two-part
          answer the design system requires — the border moves AND a ring
          appears — with only the hue changed. Near-black on white measures
          17.9:1, well past the 3:1 a focus indicator owes its surroundings. */}
      <div
        className={`flex items-center gap-3 rounded-full border bg-field px-6 transition-[border-color,box-shadow] duration-200 ease-in-out ${
          error
            ? 'border-danger group-focus-within:border-danger group-focus-within:ring-2 group-focus-within:ring-danger/20'
            : 'border-slate-200/80 hover:border-slate-300 group-focus-within:border-brand-500 group-focus-within:ring-2 group-focus-within:ring-brand-500/20'
        }`}
      >
        <input
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`min-w-0 flex-1 bg-transparent py-3.5 text-sm text-text-primary outline-none placeholder:text-transparent focus:placeholder:text-text-muted ${inputClassName}`}
          {...inputProps}
        />
        {trailing}
      </div>

      {/* `pointer-events-none` so the label never eats a click aimed at the
          field it is sitting on. The <label for> association still works —
          clicking is simply handled by the input underneath. */}
      <label
        htmlFor={id}
        className={`pointer-events-none absolute transition-all duration-200 ease-in-out ${
          filled ? FLOATED : RESTING
        } ${FLOATED_ON_FOCUS}`}
      >
        {label}
      </label>

      {/* Inside the field's own wrapper, indented to the text rather than the
          capsule's edge, so it reads as belonging to the control above it. */}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 px-6 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
