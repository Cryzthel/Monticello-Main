import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

/**
 * Row overflow menu — the `⋯` trigger plus its dropdown.
 *
 * Portalled into document.body and positioned from the trigger's bounding rect,
 * for the same reason Select and NotificationBell are: the panels hosting these
 * panels are `overflow-hidden` so their corner radius clips the rows, and the
 * table body scrolls — so an inline menu on the last row would be cut off by
 * its own container long before z-index mattered.
 *
 * `items` is `[{ label, icon, onSelect, tone }]`; `tone: 'danger'` renders the
 * destructive treatment.
 */
export default function OverflowMenu({ items = [], ariaLabel = 'Row actions' }) {
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)

  function handleToggle(event) {
    event.stopPropagation()
    const next = !open
    if (next && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-150 ${
          open
            ? 'border-tint/20 bg-tint/[0.08] text-text-primary'
            : 'border-transparent text-text-secondary hover:border-tint/10 hover:bg-tint/[0.06] hover:text-text-primary'
        }`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', top: position.top, right: position.right, '--popover-origin': 'top right' }}
              className="popover z-[var(--z-popover)] w-max min-w-[11rem] p-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {items.map(({ label, icon: Icon, onSelect, tone }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onSelect?.()
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors duration-100 ${
                    tone === 'danger'
                      ? 'text-danger hover:bg-danger/10'
                      : 'text-text-secondary hover:bg-tint/5 hover:text-text-primary'
                  }`}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                  {label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
