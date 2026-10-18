import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from '@shared/icons'
import { listTimeZones, timeZoneOffsetLabel } from '@shared/lib/dates'

const GAP = 6
const MARGIN = 8
const WIDTH = 320

/** "America/Argentina/Buenos_Aires" → { city: "Buenos Aires", region: "America · Argentina" }. */
function describe(zone) {
  const parts = zone.split('/')
  const city = parts.pop().replace(/_/g, ' ')
  return { city, region: parts.join(' · ').replace(/_/g, ' ') }
}

/** Offset minutes from a "UTC+05:30" label, for sorting. */
function offsetMinutes(label) {
  const m = /UTC([+-])(\d{2}):(\d{2})/.exec(label)
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

/**
 * A searchable time-zone picker: a field-shaped trigger, and a popover with a
 * search box over every IANA zone the browser knows, sorted by UTC offset.
 *
 * Focus moves into the search box on open and the arrows walk the filtered
 * list (`aria-activedescendant`), so it is fully usable from the keyboard:
 * type "manila" or "+08", Enter to pick, Escape to back out. The popover is
 * portalled with fixed coordinates because Settings cards clip overflow, and
 * closes on outside click or page scroll rather than float out of place.
 */
export default function TimeZoneSelect({ id, value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const listboxId = useId()

  // Built when first opened: ~420 zones × one Intl call each is cheap, but not
  // free, and most visits to Settings never open this.
  const zones = useMemo(() => {
    if (!open) return []
    const now = new Date()
    return listTimeZones()
      .map((zone) => {
        const offset = timeZoneOffsetLabel(zone, now)
        const { city, region } = describe(zone)
        return { zone, offset, city, region, haystack: `${zone} ${city} ${region} ${offset}`.toLowerCase() }
      })
      .sort((a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset) || a.zone.localeCompare(b.zone))
  }, [open])

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return zones
    return zones.filter((z) => terms.every((t) => z.haystack.includes(t) || z.haystack.includes(t.replace(/ /g, '_'))))
  }, [zones, query])

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(MARGIN, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - MARGIN))
    const below = window.innerHeight - rect.bottom
    setPosition(below >= 360 || below >= rect.top ? { top: rect.bottom + GAP, left } : { bottom: window.innerHeight - rect.top + GAP, left })
  }

  function openMenu() {
    if (disabled) return
    place()
    setQuery('')
    setOpen(true)
  }

  function close({ restoreFocus = true } = {}) {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  function pick(zone) {
    onChange(zone)
    close()
  }

  // Start on the current value, and again whenever the filter changes.
  useLayoutEffect(() => {
    if (!open) return
    const index = query ? 0 : Math.max(0, results.findIndex((z) => z.zone === value))
    setActive(index)
  }, [open, query, results, value])

  useEffect(() => {
    if (!open) return undefined
    searchRef.current?.focus({ preventScroll: true })
    const onDown = (event) => {
      if (popoverRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return
      close({ restoreFocus: false })
    }
    const onScroll = (event) => {
      if (listRef.current?.contains(event.target)) return
      close({ restoreFocus: false })
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Keep the active row in view without scrolling the page.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector(`[data-index="${active}"]`)
    const list = listRef.current
    if (!row || !list) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
    }
  }, [active, open])

  function onSearchKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(Math.max(0, results.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (results[active]) pick(results[active].zone)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') {
      close({ restoreFocus: false })
    }
  }

  const current = value ? describe(value) : null
  const optionId = (index) => `${listboxId}-opt-${index}`

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openMenu()
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={`inline-flex h-10 w-64 max-w-full items-center gap-2 rounded-xl border bg-base-950 px-3.5 text-left text-sm shadow-sm outline-none transition-[border-color,box-shadow] duration-150 disabled:opacity-60 ${
          open
            ? 'border-brand-500 ring-4 ring-brand-500/15'
            : 'border-hairline hover:border-brand-500/30 focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-text-primary">{current ? current.city : 'Select a time zone'}</span>
        <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted">{value ? timeZoneOffsetLabel(value) : ''}</span>
        <ChevronDown
          size="sm"
          aria-hidden="true"
          className={`shrink-0 text-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              style={{ position: 'fixed', width: WIDTH, ...position }}
              className="popover z-[var(--z-popover)] flex flex-col overflow-hidden p-0"
            >
              <div className="relative border-b border-hairline">
                <Search
                  size="sm"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  ref={searchRef}
                  type="text"
                  role="combobox"
                  aria-label="Search time zones"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={results[active] ? optionId(active) : undefined}
                  aria-autocomplete="list"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Search city, region or UTC offset"
                  className="h-11 w-full bg-transparent pl-10 pr-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
              <div
                ref={listRef}
                id={listboxId}
                role="listbox"
                aria-label="Time zones"
                className="custom-scrollbar max-h-72 overflow-y-auto overscroll-contain p-1.5"
              >
                {results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-text-muted">No time zone matches “{query.trim()}”.</p>
                ) : (
                  results.map((z, index) => {
                    const selected = z.zone === value
                    return (
                      <div
                        key={z.zone}
                        id={optionId(index)}
                        data-index={index}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => active !== index && setActive(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pick(z.zone)}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${
                          index === active ? 'bg-tint/[0.07]' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text-primary">{z.city}</span>
                          {z.region ? <span className="block truncate text-2xs text-text-muted">{z.region}</span> : null}
                        </span>
                        <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted">{z.offset}</span>
                        <Check
                          size="sm"
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 shrink-0 text-brand-500 ${selected ? '' : 'invisible'}`}
                        />
                      </div>
                    )
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
