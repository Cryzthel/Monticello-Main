import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

/**
 * The dashboard's one dropdown control.
 *
 * Replaces every native `<select>` in the admin portal. A native select can't
 * be styled beyond its trigger — the option list is drawn by the OS, so on
 * Windows a dark dashboard rendered a bright white popup list with system-blue
 * highlights. That was the single most jarring inconsistency in the UI and it
 * is not fixable with CSS.
 *
 * The menu is portalled into document.body and positioned from the trigger's
 * bounding rect, for the same reason NotificationBell and StatusSelect are: the
 * panels hosting these controls are `overflow-hidden` scroll containers, which
 * clip an inline absolute menu at the panel edge whatever its z-index.
 *
 * `options` accepts strings or `{ value, label, icon?, hint? }` objects.
 *
 * SIZES. `sm`/`md` are the two dense desktop steps. `touch` is `md` with a
 * 44px trigger below `sm:` — the WCAG 2.5.8 / iOS HIG minimum — collapsing back
 * to 36px once there is a pointer. It exists as a named size rather than an
 * `h-11 sm:h-9` passed through `className` because two height utilities in one
 * class string resolve by stylesheet order, not by the order they are written,
 * so the override silently wins or loses depending on how Tailwind sorted them
 * that build.
 */
const SIZES = {
  sm: 'h-8 text-xs',
  md: 'h-9 text-sm',
  touch: 'h-11 text-sm sm:h-9',
}

/**
 * Fill, by context. `toolbar` is the recessed well the search fields beside
 * it use; `field` is `.field`'s white box, for a Select inside a form, where
 * a grey trigger was the one control between white inputs that looked
 * different for no reason.
 */
const VARIANTS = {
  toolbar: 'bg-base-800 hover:bg-tint/[0.03]',
  field: 'bg-field',
}

export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  size = 'md',
  variant = 'toolbar',
  align = 'left',
  /** Small muted label rendered inside the trigger, before the value. */
  prefix,
  className = '',
  ariaLabel,
}) {
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)

  const normalized = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  )
  const selected = normalized.find((option) => option.value === value)
  const height = SIZES[size] ?? SIZES.md

  function handleToggle(event) {
    event.stopPropagation()
    if (disabled) return
    const next = !open
    if (next && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const gap = 6
      const below = window.innerHeight - rect.bottom - gap
      const above = rect.top - gap
      // Flip upward when the room under the trigger can't hold a usable list.
      // A filter two thirds down a phone screen otherwise drops its menu past
      // the bottom of the viewport, where it can neither be read nor dismissed
      // by tapping an option — which reads as the control having locked up.
      const flip = below < 180 && above > below
      setPosition({
        ...(flip ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
        ...(align === 'right'
          ? { right: Math.max(8, window.innerWidth - rect.right) }
          : { left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) }),
        minWidth: rect.width,
        // Inline, so it beats the `max-h-72` class: whichever side we opened
        // on, the menu stays inside the viewport rather than being clipped.
        maxHeight: Math.max(160, (flip ? above : below) - 8),
      })
    }
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return undefined

    function handleClickOutside(event) {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return
      }
      setOpen(false)
    }
    /**
     * ── ESCAPE CLOSES THIS MENU AND NOTHING ELSE ───────────────────────────
     * `capture: true` plus `stopPropagation`, not a plain listener, and the
     * two are one decision.
     *
     * Every dialog in both consoles closes itself on a document-level
     * `keydown` in the BUBBLE phase (ConfirmDialog, IncidentDetailModal,
     * FileReportModal, the announcement composer, …). A Select inside one of
     * them therefore shared a keystroke with it: one Escape dismissed the
     * dropdown AND the dialog behind it, so backing out of a four-option menu
     * threw away a half-written report. Verified on the guardhouse report
     * composer, where the Priority menu did exactly that.
     *
     * Registration order cannot fix it — the dialog mounts first, and
     * same-target listeners fire in the order they were added, so the dialog
     * always got there first. The capture phase runs on `document` before ANY
     * bubble listener on it, whenever they were registered, which makes the
     * rule order-independent: while a menu is open it is the innermost
     * dismissable thing on screen, so it is the one Escape acts on.
     *
     * The listener only exists while `open`, so Escape reaches the dialog
     * normally the rest of the time.
     */
    function handleKeydown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown, true)
    // Coordinates computed from a bounding rect go stale the moment the page
    // behind the menu scrolls, so close rather than float out of place.
    const closeOnScroll = () => setOpen(false)
    window.addEventListener('scroll', closeOnScroll, { capture: true, once: true })

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('scroll', closeOnScroll, { capture: true })
    }
  }, [open])

  const SelectedIcon = selected?.icon

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        // Pill geometry per the spec's filter-chip rule, with `px-3.5` rather
        // than the old `px-2.5`: the curve eats horizontal room at the ends, so
        // a pill needs more padding than a rounded rectangle for the same
        // optical inset.
        className={`inline-flex ${height} items-center gap-2 rounded-lg border ${VARIANTS[variant] ?? VARIANTS.toolbar} px-3.5 font-medium text-text-primary transition-[color,background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'
        } ${className}`}
      >
        {prefix ? <span className="shrink-0 text-text-muted">{prefix}</span> : null}
        {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" /> : null}
        <span className={`truncate ${selected ? '' : 'text-text-muted'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                ...position,
                // Grow out of the trigger's edge, whichever side it opened on.
                '--popover-origin': `${position.bottom != null ? 'bottom' : 'top'} ${align === 'right' ? 'right' : 'left'}`,
              }}
              className="popover custom-scrollbar z-[var(--z-popover)] max-h-72 w-max min-w-[9rem] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain p-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {normalized.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-text-muted">No options</p>
              ) : (
                normalized.map((option) => {
                  const active = option.value === value
                  const OptionIcon = option.icon
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        if (option.value !== value) onChange?.(option.value)
                      }}
                      // min-h-11 below `sm:` — an option row is a tap target
                      // like any other, and 30px of it was not one.
                      // Pills, matching the sidebar nav rows — both are
                      // full-width selectable rows, so they take the same
                      // geometry and the same pastel-emerald selected state.
                      className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-100 sm:min-h-0 sm:text-xs ${
                        active
                          ? 'bg-nav-active text-nav-active-fg'
                          : 'text-text-secondary hover:bg-tint/[0.05] hover:text-text-primary'
                      }`}
                    >
                      {OptionIcon ? <OptionIcon className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
                      <span className="truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="ml-1 shrink-0 text-2xs text-text-muted">{option.hint}</span>
                      ) : null}
                      {active ? <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-brand-400" /> : null}
                    </button>
                  )
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
