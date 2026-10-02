import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MapPin, Search, X } from '@shared/icons'
import { parseAddressQuery, suggestAddresses } from '@shared/lib/addressQuery'

/**
 * One search box over people AND addresses, with an address picker attached.
 *
 * ── WHAT THIS REPLACED ────────────────────────────────────────────────────
 *
 * The Residents filter bar carried four controls: a free-text search over
 * name/email/phone/address, and three dependent dropdowns for Phase, Block and
 * Lot. Finding one household meant three clicks through three lists whose
 * options only made sense in order, and the search box beside them could not
 * do the same job because it matched the joined address as a raw substring —
 * "block 14 phase 2" failed on word order, "P2 B14" failed outright.
 *
 * With a parser behind it (see lib/addressQuery) one box does both, so the
 * three dropdowns had nothing left to offer. The control keeps the free-text
 * half: an operator far more often knows a name than a lot number, and
 * "dela cruz block 14" narrows by both at once.
 *
 * ── WHY A SUGGESTION LIST AND NOT JUST LIVE FILTERING ─────────────────────
 *
 * Typing already filters the table underneath, so the list is not there to
 * show results — it is there to show what EXISTS. "Block 14" is ambiguous
 * until you can see that it holds lots 7, 9 and 10; the dropdowns used to
 * answer that and nothing else would have. Picking an entry commits its exact
 * address to the box, which is the one gesture the cascade was good at.
 *
 * The list is the live collection grouped, not a stored index: it cannot drift
 * from the data, and it can never offer an address that matches nothing.
 */
export default function AddressSearch({
  value,
  onChange,
  /** Distinct addresses to offer, from `buildAddressIndex`. */
  index,
  placeholder = 'Search by name, email, or address',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()

  const parsed = useMemo(() => parseAddressQuery(value), [value])
  const suggestions = useMemo(
    () => (value.trim() ? suggestAddresses(index, parsed) : []),
    [index, parsed, value],
  )

  // A fresh query is a fresh list, so the highlight cannot point at a row that
  // has since been filtered out from under it.
  useEffect(() => setActiveIndex(-1), [value])

  /*
   * Close on an outside press, not on blur. Blur fires before the click that
   * caused it resolves, so a mousedown on a suggestion would close the list
   * and cancel its own selection — the classic dropdown that cannot be
   * clicked, only keyboard-selected.
   */
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const commit = (entry) => {
    onChange(entry.label)
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Escape closes the list; a second Escape clears the box. Closing and
      // clearing on the same key would lose a long query to a stray press.
      if (open) setOpen(false)
      else if (value) onChange('')
      return
    }
    if (!suggestions.length) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i + step + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault()
      commit(suggestions[activeIndex])
    }
  }

  const showList = open && suggestions.length > 0

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/*
        The same oblong as SearchField, deliberately: this sits in a filter bar
        beside a segmented control on a 36px baseline, and a taller box for the
        one control that matters most would break the row it leads. The brief's
        `py-2.5` is spent on the suggestion rows instead, where the density
        actually helps.
      */}
      <div
        className={`flex h-11 min-w-0 items-center gap-2 rounded-full border bg-field pl-4 transition-[border-color,box-shadow] duration-150 sm:h-9 ${
          value ? 'pr-1.5' : 'pr-4'
        } ${
          showList
            ? 'border-brand-500 ring-2 ring-brand-500/20'
            : 'border-slate-200 hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20'
        }`}
      >
        {/* The glyph states which of the two jobs the box is doing right now. */}
        {parsed.hasAddress ? (
          <MapPin size="sm" className="shrink-0 text-brand-400" aria-hidden="true" />
        ) : (
          <Search size="sm" className="shrink-0 text-text-secondary" aria-hidden="true" />
        )}

        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-full w-full min-w-0 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-sm"
        />

        {value ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="icon-btn icon-btn-plain h-8 w-8 shrink-0"
          >
            <X size="sm" />
          </button>
        ) : null}
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching addresses"
          className="popover absolute left-0 right-0 top-full z-[var(--z-popover)] mt-1.5 max-h-72 overflow-y-auto p-1.5"
          style={{ '--popover-origin': 'top' }}
        >
          {suggestions.map((entry, i) => (
            <li key={entry.key}>
              <button
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                // `onMouseDown` preventDefault keeps focus in the input, so the
                // caret does not jump and the list does not flicker closed
                // between press and release.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(entry)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-100 ${
                  i === activeIndex ? 'bg-tint/[0.07]' : ''
                }`}
              >
                <MapPin size="sm" className="shrink-0 text-text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                  {entry.label}
                </span>
                {/* The count is why this list beats three dropdowns: it says how
                    many households sit at an address before you commit to it. */}
                <span className="count-pill shrink-0 text-text-secondary">{entry.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
