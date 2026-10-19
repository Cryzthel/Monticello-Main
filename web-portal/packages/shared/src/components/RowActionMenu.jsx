import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Eye, Send, CheckCircle2 } from '@shared/icons'
import { belowTrigger, flipIfOverflowing } from '@shared/lib/menuPosition'

// Portal-based, same reasoning as shared/components/NotificationBell: the
// table body it lives in scrolls (overflow-y-auto), which would clip an
// inline absolutely-positioned dropdown.
export default function RowActionMenu({
  onView,
  onDispatch,
  onResolve,
  dispatchDisabled,
  resolveDisabled,
  // Labels are overridable so the same menu reads correctly on non-incident
  // tables (e.g. Residents uses Approve / Reject).
  dispatchLabel = 'Mark dispatched',
  resolveLabel = 'Mark resolved',
  // Glyphs are overridable for the same reason (Residents: approve / reject).
  dispatchIcon: DispatchIcon = Send,
  resolveIcon: ResolveIcon = CheckCircle2,
  dispatchIconClass = 'text-brand-400',
  resolveIconClass = 'text-success',
}) {
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)

  function handleToggle(event) {
    event.stopPropagation()
    const next = !open
    if (next && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPosition(belowTrigger(rect))
    }
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return undefined
    function handleClickOutside(event) {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
      setOpen(false)
    }
    // Escape and scroll close it too, as OverflowMenu does. Without the
    // scroll close, the fixed-position menu stayed put while the row it
    // belonged to scrolled away underneath it.
    function handleKeydown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnScroll = () => setOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeydown)
    window.addEventListener('scroll', closeOnScroll, { capture: true, once: true })
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('scroll', closeOnScroll, { capture: true })
    }
  }, [open])

  // Flip above the trigger when the rendered menu would run off the bottom
  // of the window — the last rows on a page. Layout effect: measured and
  // moved before the browser paints, so it never flashes in the wrong place.
  useLayoutEffect(() => {
    if (!open || !position || position.bottom != null) return
    const menu = panelRef.current?.getBoundingClientRect()
    const trigger = buttonRef.current?.getBoundingClientRect()
    if (!menu || !trigger) return
    const flipped = flipIfOverflowing(trigger, menu)
    if (flipped) setPosition(flipped)
  }, [open, position])


  function runAction(action) {
    setOpen(false)
    action?.()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-label="Row actions"
        aria-expanded={open}
        className={`icon-btn icon-btn-sm ${open ? 'icon-btn-active' : ''}`}
      >
        <MoreHorizontal size="sm" />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              style={{ position: 'fixed', top: position.top, bottom: position.bottom, right: position.right, '--popover-origin': position.origin }}
              className="popover z-[var(--z-popover)] w-52 p-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {/* One row shape for all three actions — 2.25rem tall, 0.875rem
                  glyph, 0.625rem gap. The tone lives in the icon colour only;
                  the label stays white so the menu reads as a list of actions
                  rather than three competing colours. */}
              <button
                type="button"
                onClick={() => runAction(onView)}
                className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs font-medium text-text-primary transition-colors duration-150 hover:bg-tint/[0.07]"
              >
                <Eye size="sm" className="shrink-0 text-text-secondary" />
                View details
              </button>
              {/* Mutating actions are rendered only when a handler is supplied.
                  They used to render unconditionally, which meant a caller with
                  no `onDispatch` still drew a Mark Dispatched row that looked
                  live and silently did nothing when pressed.
                  That is now load-bearing rather than tidiness: the Admin
                  portal is read-only for incident status, and it withholds
                  these handlers to say so. A control that renders anyway would
                  advertise an authority the operator does not have. */}
              {onDispatch ? (
                <button
                  type="button"
                  disabled={dispatchDisabled}
                  onClick={() => runAction(onDispatch)}
                  className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs font-medium text-text-primary transition-colors duration-150 hover:bg-tint/[0.07] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <DispatchIcon size="sm" className={`shrink-0 ${dispatchIconClass}`} aria-hidden="true" />
                  {dispatchLabel}
                </button>
              ) : null}
              {onResolve ? (
                <button
                  type="button"
                  disabled={resolveDisabled}
                  onClick={() => runAction(onResolve)}
                  className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs font-medium text-text-primary transition-colors duration-150 hover:bg-tint/[0.07] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ResolveIcon size="sm" className={`shrink-0 ${resolveIconClass}`} aria-hidden="true" />
                  {resolveLabel}
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
