import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from '@shared/icons'
import { statusStyle, INCIDENT_STATUSES } from '@shared/theme/statusStyles'

/**
 * Status dropdown — a pill field control, not a native <select>.
 *
 * SHAPE
 * -----
 * Geometry is copied from shared/components/Select.jsx exactly: `h-9`,
 * `rounded-lg`, `border-slate-100`, `bg-base-800`, `px-3.5`, `gap-2`,
 * `text-sm`. The two are the dashboard's only dropdowns, so they are the same
 * object — a filter in the tickets toolbar and a filter in the announcements
 * feed should not be two different controls.
 *
 * This trigger IS a pill now, which the Soft Modernism pass made the shape of
 * every action control. It is still not a StatusBadge: the colour coding a
 * badge would carry is supplied here by the leading status dot instead, so the
 * column can be scanned by state while the chevron keeps the control legible
 * as something you can click rather than a tag you cannot.
 *
 * WIDTH
 * -----
 * `min-w-[8.5rem]` is sized to the longest option ("Dispatched") rather than
 * picked round: wide enough that changing the selection never reflows the
 * toolbar around it, and not one step wider. The previous `min-w-[9rem]` on a
 * two-character "All" left ~95px of dead space inside the trigger.
 *
 * The menu is portalled into document.body and positioned from the trigger's
 * bounding rect for the same reason NotificationBell/RowActionMenu are: the
 * panels hosting these controls are `overflow-hidden` scroll containers, which
 * clip an inline absolute menu at the panel edge.
 *
 * `onChange` receives the display status string. Pass `options` to override
 * the list (e.g. adding an "All" entry for filter use).
 */
export default function StatusSelect({
  value,
  onChange,
  options = INCIDENT_STATUSES,
  disabled = false,
  size = 'md',
  align = 'left',
  placeholder = 'Set status',
  className = '',
}) {
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)

  function handleToggle(event) {
    event.stopPropagation()
    if (disabled) return
    const next = !open
    if (next && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom + 6,
        ...(align === 'right'
          ? { right: window.innerWidth - rect.right }
          : { left: rect.left }),
        minWidth: rect.width,
      })
    }
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return undefined
    function handleClickOutside(event) {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return
      setOpen(false)
    }
    function handleKeydown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
    // A dropdown positioned from a bounding rect goes stale the moment the
    // page behind it scrolls, so close instead of floating out of place.
    const closeOnScroll = () => setOpen(false)
    window.addEventListener('scroll', closeOnScroll, { capture: true, once: true })
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('scroll', closeOnScroll, { capture: true })
    }
  }, [open])

  const height = size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm'
  const { dot } = statusStyle(value)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex ${height} min-w-[8.5rem] items-center gap-2 rounded-lg border bg-base-800 px-3.5 font-medium text-text-primary transition hover:bg-tint/[0.06] disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? 'border-brand-500/50' : 'border-tint/10 hover:border-tint/20'
        } ${className}`}
      >
        {/* The dot is what survives of the pill: status stays scannable down a
            column without the control having to be tinted end to end. */}
        <span className={`h-2 w-2 shrink-0 rounded-full ${value ? dot : 'bg-text-muted'}`} />
        <span className={`truncate ${value ? '' : 'text-text-muted'}`}>{value ?? placeholder}</span>
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
              role="listbox"
              style={{ position: 'fixed', ...position }}
              // min-w matches Select's menu exactly. `w-max` already sizes to
              // the longest option, so the previous 10rem floor only ever
              // added padding to the right of every row.
              className="custom-scrollbar z-[var(--z-popover)] max-h-72 w-max min-w-[9rem] origin-top animate-[fadeIn_120ms_ease-out] overflow-y-auto rounded-lg bg-base-850 p-1.5 shadow-overlay"
              onClick={(event) => event.stopPropagation()}
            >
              {options.map((option) => {
                const { icon: Icon, dot: optionDot } = statusStyle(option)
                const active = option === value
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setOpen(false)
                      if (option !== value) onChange?.(option)
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
                      active ? 'bg-tint/[0.07] text-text-primary' : 'text-text-secondary hover:bg-tint/5 hover:text-text-primary'
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${optionDot}`} />
                    <Icon size="sm" className="shrink-0 opacity-70" />
                    {option}
                    {active ? <Check size="sm" className="ml-auto shrink-0 text-brand-400" /> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
