import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from '@shared/icons'
import { listTimeZones, timeZoneOffsetLabel } from '@shared/lib/dates'

const GAP = 6
const MARGIN = 8
const WIDTH = 320
/** Every row is exactly this tall, so the window below is pure arithmetic. */
const ROW_HEIGHT = 48
/** The list's height (max-h-72) and padding (p-1.5). */
const LIST_HEIGHT = 288
const LIST_PAD = 6
/** Rows rendered beyond each edge of the visible window. */
const OVERSCAN = 6

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
 * ── THE LIST IS BUILT ONCE PER DAY, NOT PER OPEN ───────────────────────────
 * Every zone's label and current offset is computed the first time the picker
 * opens and kept at module level. Offsets only move at a daylight-saving
 * change, so the cache is keyed on the date and rebuilt at most once a day.
 * This was the bulk of the lag: ~420 formatter builds on every open.
 */
let zoneCache = { day: '', zones: [] }
function getZones() {
  const now = new Date()
  const day = now.toDateString()
  if (zoneCache.day !== day) {
    const zones = listTimeZones()
      .map((zone) => {
        const offset = timeZoneOffsetLabel(zone, now)
        const { city, region } = describe(zone)
        return { zone, offset, city, region, haystack: `${zone} ${city} ${region} ${offset}`.toLowerCase().replace(/_/g, ' ') }
      })
      .sort((a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset) || a.zone.localeCompare(b.zone))
    zoneCache = { day, zones }
  }
  return zoneCache.zones
}

/**
 * One row. Memoised, and its handlers are stable, so moving the highlight
 * re-renders the two rows whose `active` changed — not all ~420. Re-rendering
 * the whole list on every pointer move was the other half of the lag.
 */
const ZoneOption = memo(function ZoneOption({ z, index, total, id, active, selected, onPick, onHover }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={total}
      onPointerMove={() => onHover(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(z.zone)}
      style={{ height: ROW_HEIGHT }}
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 ${active ? 'bg-tint/[0.07]' : ''}`}
    >
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm text-text-primary">{z.city}</span>
        {z.region ? <span className="block truncate text-2xs text-text-muted">{z.region}</span> : null}
      </span>
      <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted">{z.offset}</span>
      <Check size="sm" aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-brand-500 ${selected ? '' : 'invisible'}`} />
    </div>
  )
})

/**
 * A searchable time-zone picker: a field-shaped trigger, and a popover with a
 * search box over every IANA zone the browser knows, sorted by UTC offset.
 *
 * Focus moves into the search box on open and the arrows walk the filtered
 * list (`aria-activedescendant`): type "manila" or "+08", Enter to pick,
 * Escape to back out. Filtering runs on a deferred copy of the query, so
 * typing never waits on the list. The popover is portalled with fixed
 * coordinates because Settings sections clip overflow, and closes on an
 * outside click or a page scroll rather than float out of place.
 */
export default function TimeZoneSelect({ id, value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState(null)
  const [scrollTop, setScrollTop] = useState(0)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const listboxId = useId()

  const zones = useMemo(() => (open ? getZones() : []), [open])

  const results = useMemo(() => {
    const terms = deferredQuery.trim().toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(Boolean)
    if (!terms.length) return zones
    return zones.filter((z) => terms.every((t) => z.haystack.includes(t)))
  }, [zones, deferredQuery])

  const valueLabel = useMemo(() => (value ? { city: describe(value).city, offset: timeZoneOffsetLabel(value) } : null), [value])

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(MARGIN, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - MARGIN))
    const below = window.innerHeight - rect.bottom
    setPosition(
      below >= 360 || below >= rect.top
        ? { top: rect.bottom + GAP, left }
        : { bottom: window.innerHeight - rect.top + GAP, left },
    )
  }, [])

  function openMenu() {
    if (disabled) return
    place()
    setQuery('')
    setOpen(true)
  }

  const close = useCallback(({ restoreFocus = true } = {}) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const pick = useCallback(
    (zone) => {
      onChange(zone)
      close()
    },
    [onChange, close],
  )

  const hover = useCallback((index) => setActive((current) => (current === index ? current : index)), [])

  // Start on the current value, and at the top whenever the filter changes.
  useLayoutEffect(() => {
    if (!open) return
    setActive(deferredQuery ? 0 : Math.max(0, results.findIndex((z) => z.zone === value)))
  }, [open, deferredQuery, results, value])

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
  }, [open, close, place])

  // Keep the active row in view. Computed from the fixed row height, so it
  // reads no layout — reading offsetTop here forced a reflow of the whole
  // list on every highlight move.
  useEffect(() => {
    const list = listRef.current
    if (!open || !list) return
    const top = LIST_PAD + active * ROW_HEIGHT
    let next = list.scrollTop
    if (top < next) next = top - LIST_PAD
    else if (top + ROW_HEIGHT > next + LIST_HEIGHT) next = top + ROW_HEIGHT - LIST_HEIGHT + LIST_PAD
    if (next !== list.scrollTop) {
      list.scrollTop = next
      // Move the rendered window now, not when the scroll event lands — and
      // to where the browser actually scrolled (it clamps), so the rows drawn
      // can never disagree with the rows in view.
      setScrollTop(list.scrollTop)
    }
  }, [active, open])

  // A new filter starts at the top of the list.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setScrollTop(0)
  }, [deferredQuery])

  // ── ONLY THE VISIBLE ROWS ARE RENDERED ─────────────────────────────────
  // ~420 rows mounted at once was what made opening the picker lag. The list
  // keeps its full scroll height (padding above and below) and mounts the
  // ~6 rows in view plus OVERSCAN either side, so opening, scrolling and
  // hovering cost the same whether there are 5 results or 420.
  const first = Math.max(0, Math.floor((scrollTop - LIST_PAD) / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(results.length, Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN)
  const visible = results.slice(first, last)

  function onSearchKey(event) {
    const last = Math.max(0, results.length - 1)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(last, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(last)
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
        className={`inline-flex h-10 w-full items-center gap-2 rounded-lg border bg-base-900/50 px-4 text-left text-sm shadow-sm outline-none transition-[border-color,box-shadow] duration-150 disabled:opacity-60 ${
          open
            ? 'border-brand-500/60 ring-2 ring-brand-500/20'
            : 'border-hairline hover:border-brand-500/30 focus-visible:border-brand-500/60 focus-visible:ring-2 focus-visible:ring-brand-500/20'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-text-primary">{valueLabel ? valueLabel.city : 'Select a time zone'}</span>
        <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted">{valueLabel?.offset}</span>
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
                  aria-activedescendant={active >= first && active < last ? optionId(active) : undefined}
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
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                style={{ maxHeight: LIST_HEIGHT, padding: LIST_PAD }}
                className="custom-scrollbar overflow-y-auto overscroll-contain"
              >
                {results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-text-muted">No time zone matches “{query.trim()}”.</p>
                ) : (
                  <div style={{ height: results.length * ROW_HEIGHT, paddingTop: first * ROW_HEIGHT }}>
                    {visible.map((z, offset) => {
                      const index = first + offset
                      return (
                        <ZoneOption
                          key={z.zone}
                          z={z}
                          index={index}
                          total={results.length}
                          id={optionId(index)}
                          active={index === active}
                          selected={z.zone === value}
                          onPick={pick}
                          onHover={hover}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
