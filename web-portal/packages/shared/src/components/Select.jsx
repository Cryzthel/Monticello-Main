import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from '@shared/icons'

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
 * ── IT IS A LISTBOX, AND NOW IT SAYS SO ───────────────────────────────────
 * This looked like a select and was announced as "button, collapsed". The
 * trigger carried `aria-expanded` and nothing else — no role, no
 * `aria-controls` — and the menu was a plain `div` of plain `button`s, so a
 * screen reader read six unrelated buttons with no sense of how many there
 * were, which one was chosen, or that choosing one answered a question. The
 * only keyboard route through it was Tab, one option at a time, in the
 * document's tab order.
 *
 * It now implements the ARIA 1.2 select-only combobox: `role="combobox"` with
 * `aria-haspopup="listbox"` and `aria-controls` on the trigger, a
 * `role="listbox"` menu, `role="option"` rows carrying `aria-selected`, and
 * arrow-key navigation driven by `aria-activedescendant`.
 *
 * FOCUS STAYS ON THE TRIGGER. The alternative — moving DOM focus into the
 * menu — fights two things this component already does: the portal (focus
 * leaving the dialog's subtree trips `useDialogFocus`'s trap) and the
 * outside-click handler. `aria-activedescendant` is the pattern's own answer
 * for exactly this, and it keeps the option rows out of the tab order
 * entirely, which is what a listbox should do.
 *
 * ── "SEARCHABLE" IS TYPEAHEAD, NOT A SEARCH BOX ───────────────────────────
 * Typing jumps to the first option whose label starts with what you typed,
 * the way a native `<select>` does, with the buffer clearing after a pause.
 *
 * A filter INPUT was considered and rejected for these lists. Every call site
 * here is between four and eight options, all visible at once without
 * scrolling; a text field above them adds a second focusable thing, a second
 * Escape target inside a dialog that already fought over Escape (see the
 * note below), and an empty state to design — to filter a list you can read
 * in one glance. If a call site ever passes a few dozen options, THAT is when
 * this grows a filter box, and it should grow one behind a prop rather than
 * for everybody.
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
  /**
   * Pick several. `value` becomes an array and `onChange` is handed the next
   * array; the menu stays open between picks and each row carries a tick.
   *
   * ── WHY THIS LIVES HERE AND NOT IN A SECOND COMPONENT ──────────────────
   * A multi-select is this control with three differences — what `value`
   * holds, whether a click closes the menu, and what the trigger prints — and
   * every other thing about it is the part that was hard: the portalled menu,
   * the flip-up when there is no room below, the outside-click and Escape
   * handling, the 44px touch rows. A sibling component would have copied all
   * of that to change three lines, and then drifted from it.
   *
   * Defaults off, so every existing call site is untouched.
   */
  multiple = false,
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
  /**
   * The row the arrow keys are on, which is NOT the row that is chosen.
   * `aria-activedescendant` points at it; `aria-selected` marks the other.
   * Keeping them separate is what lets someone arrow past their current
   * answer and change their mind without having committed anything.
   */
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const optionId = (index) => `${listboxId}-option-${index}`
  /** Typeahead buffer. A ref, not state: nothing renders from it. */
  const typed = useRef({ text: '', at: 0 })

  const normalized = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  )
  const picked = multiple ? (Array.isArray(value) ? value : []) : []
  const selected = multiple ? null : normalized.find((option) => option.value === value)
  const height = SIZES[size] ?? SIZES.md

  /**
   * What the trigger says when several things are chosen.
   *
   * One pick prints its own label, because "1 selected" is strictly less
   * information than the thing it is hiding. Past that it counts: three
   * labels joined by commas is wider than any trigger on this panel and
   * truncates to "Area secured, Resident cont…", which is the worst of both
   * — it neither names them nor tells you how many there are.
   */
  const pickedLabel =
    picked.length === 1
      ? (normalized.find((option) => option.value === picked[0])?.label ?? placeholder)
      : picked.length > 1
        ? `${picked.length} selected`
        : null

  /**
   * Where the menu goes, measured from the trigger.
   *
   * Lifted out of the click handler because the keyboard can open the menu
   * too, and a menu opened by ArrowDown with no position never rendered.
   */
  const measure = useCallback(() => {
    if (!triggerRef.current) return null
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6
    const below = window.innerHeight - rect.bottom - gap
    const above = rect.top - gap
    // Flip upward when the room under the trigger can't hold a usable list.
    // A filter two thirds down a phone screen otherwise drops its menu past
    // the bottom of the viewport, where it can neither be read nor dismissed
    // by tapping an option — which reads as the control having locked up.
    const flip = below < 180 && above > below
    return {
      ...(flip ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
      ...(align === 'right'
        ? { right: Math.max(8, window.innerWidth - rect.right) }
        : { left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) }),
      minWidth: rect.width,
      // Inline, so it beats the `max-h-72` class: whichever side we opened
      // on, the menu stays inside the viewport rather than being clipped.
      maxHeight: Math.max(160, (flip ? above : below) - 8),
    }
  }, [align])

  /** Opens the menu with a row already under the arrow keys. */
  const openMenu = useCallback(
    (startIndex) => {
      if (disabled) return
      const next = measure()
      if (!next) return
      setPosition(next)
      setActiveIndex(startIndex)
      setOpen(true)
    },
    [disabled, measure],
  )

  const closeMenu = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
    typed.current = { text: '', at: 0 }
  }, [])

  /**
   * The row to land on when the menu opens: whatever is already chosen, so
   * the first ArrowDown moves one step from the current answer rather than
   * jumping to the top of the list.
   */
  const initialIndex = () => {
    const current = multiple
      ? normalized.findIndex((option) => picked.includes(option.value))
      : normalized.findIndex((option) => option.value === value)
    return current >= 0 ? current : 0
  }

  function commit(index) {
    const option = normalized[index]
    if (!option) return
    if (multiple) {
      const on = picked.includes(option.value)
      onChange?.(on ? picked.filter((v) => v !== option.value) : [...picked, option.value])
      // The menu stays open — see the click handler below for why.
      return
    }
    closeMenu()
    if (option.value !== value) onChange?.(option.value)
  }

  function handleToggle(event) {
    event.stopPropagation()
    if (disabled) return
    if (open) closeMenu()
    else openMenu(initialIndex())
  }

  /**
   * ── THE KEYBOARD CONTRACT ──────────────────────────────────────────────
   * Arrow keys open the menu and move within it, Enter and Space commit,
   * Home and End jump to the ends, Tab closes and moves on, and printable
   * characters run the typeahead. Escape is handled on `document` in the
   * capture phase instead — see the long note in the effect below, which is
   * about not closing the dialog behind the menu.
   *
   * `preventDefault` on the arrows and on Space matters: without it
   * ArrowDown scrolls the dialog under the open menu, and Space scrolls the
   * page while the trigger is focused and closed.
   */
  function handleKeyDown(event) {
    if (disabled) return
    const count = normalized.length
    const { key } = event

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu(initialIndex())
        return
      }
      if (!count) return
      const delta = key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i + delta + count) % count)
      return
    }

    if (key === 'Home' || key === 'End') {
      if (!open || !count) return
      event.preventDefault()
      setActiveIndex(key === 'Home' ? 0 : count - 1)
      return
    }

    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault()
      if (!open) {
        openMenu(initialIndex())
        return
      }
      commit(activeIndex)
      return
    }

    if (key === 'Tab') {
      // Not preventDefault: Tab should still move on. It just must not leave
      // a menu floating over the control it has left.
      if (open) closeMenu()
      return
    }

    // ── TYPEAHEAD ──────────────────────────────────────────────────────
    // Single printable characters only, so modifier combinations and the
    // browser's own shortcuts are untouched.
    if (key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    const now = Date.now()
    // A second's pause ends a word. Within it, keystrokes accumulate, so
    // "re" reaches "Resident unreachable" past "Resolved on site".
    const text = (now - typed.current.at < 1000 ? typed.current.text : '') + key.toLowerCase()
    typed.current = { text, at: now }
    const match = normalized.findIndex((option) =>
      String(option.label).toLowerCase().startsWith(text),
    )
    if (match < 0) return
    event.preventDefault()
    if (!open) openMenu(match)
    else setActiveIndex(match)
  }

  useEffect(() => {
    if (!open) return undefined

    function handleClickOutside(event) {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) {
        return
      }
      closeMenu()
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
      closeMenu()
      // Focus goes back to the control the menu belongs to, rather than
      // being left on a trigger the user may have arrowed away from.
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown, true)
    // Coordinates computed from a bounding rect go stale the moment the page
    // behind the menu scrolls, so close rather than float out of place.
    const closeOnScroll = () => closeMenu()
    window.addEventListener('scroll', closeOnScroll, { capture: true, once: true })

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('scroll', closeOnScroll, { capture: true })
    }
  }, [open, closeMenu])

  /**
   * Keep the arrowed-to row on screen. `block: 'nearest'` so a list that
   * already shows the row does not scroll at all — jumping it to the centre
   * on every keystroke makes a short list feel like it is sliding around.
   */
  useEffect(() => {
    if (!open || activeIndex < 0) return
    menuRef.current?.querySelector(`#${CSS.escape(optionId(activeIndex))}`)?.scrollIntoView({
      block: 'nearest',
    })
  })

  const SelectedIcon = selected?.icon

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        // Pill geometry per the spec's filter-chip rule, with `px-3.5` rather
        // than the old `px-2.5`: the curve eats horizontal room at the ends, so
        // a pill needs more padding than a rounded rectangle for the same
        // optical inset.
        className={`inline-flex ${height} items-center gap-2 rounded-full border ${VARIANTS[variant] ?? VARIANTS.toolbar} px-3.5 font-medium text-text-primary transition-[color,background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'
        } ${className}`}
      >
        {prefix ? <span className="shrink-0 text-text-muted">{prefix}</span> : null}
        {SelectedIcon ? <SelectedIcon size="sm" className="shrink-0 text-text-secondary" /> : null}
        <span className={`truncate ${selected || pickedLabel ? '' : 'text-text-muted'}`}>
          {selected?.label ?? pickedLabel ?? placeholder}
        </span>
        <ChevronDown
          size="sm"
          className={`ml-auto text-text-secondary transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              aria-multiselectable={multiple || undefined}
              // Focus never comes here — the trigger keeps it and points at
              // the active row with `aria-activedescendant`.
              tabIndex={-1}
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
                normalized.map((option, index) => {
                  const active = multiple ? picked.includes(option.value) : option.value === value
                  const focused = index === activeIndex
                  const OptionIcon = option.icon
                  return (
                    <button
                      key={option.value}
                      id={optionId(index)}
                      type="button"
                      role="option"
                      aria-selected={active}
                      // Out of the tab order: a listbox is reached by its
                      // trigger and walked with the arrows, not tabbed
                      // through one row at a time.
                      tabIndex={-1}
                      // A pointer entering a row takes the highlight with it,
                      // so the keyboard's idea of "current" and the mouse's
                      // never disagree on screen.
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        // A multi-select that closes on every pick makes
                        // choosing three things a three-time reopen. `commit`
                        // leaves it open for that case and closes it for the
                        // single-choice one.
                        setActiveIndex(index)
                        commit(index)
                      }}
                      // min-h-11 below `sm:` — an option row is a tap target
                      // like any other, and 30px of it was not one.
                      // Pills, matching the sidebar nav rows — both are
                      // full-width selectable rows, so they take the same
                      // geometry and the same pastel-emerald selected state.
                      // SELECTED and FOCUSED are drawn differently on
                      // purpose. Selected is the pastel-emerald nav fill —
                      // "this is your answer". Focused is the neutral hover
                      // tint — "this is where the arrow keys are". Collapsing
                      // them into one treatment is how a keyboard user ends
                      // up unable to tell what they have chosen from what
                      // they are merely pointing at.
                      className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-100 sm:min-h-0 sm:text-xs ${
                        active
                          ? 'bg-nav-active text-nav-active-fg'
                          : focused
                            ? 'bg-tint/[0.05] text-text-primary'
                            : 'text-text-secondary hover:bg-tint/[0.05] hover:text-text-primary'
                      } ${focused && active ? 'ring-1 ring-inset ring-brand-500/40' : ''}`}
                    >
                      {OptionIcon ? <OptionIcon size="sm" className="shrink-0 opacity-70" /> : null}
                      <span className="truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="ml-1 shrink-0 text-2xs text-text-muted">{option.hint}</span>
                      ) : null}
                      {active ? <Check size="sm" className="ml-auto shrink-0 text-brand-400" /> : null}
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
