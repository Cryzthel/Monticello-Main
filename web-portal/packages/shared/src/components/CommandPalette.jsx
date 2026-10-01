import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from '@shared/icons'

// Lightweight quick-nav palette (Cmd/Ctrl+K) — not a fuzzy search index over
// incident data, just fast jumps between admin pages by name.
export default function CommandPalette({ open, onClose, navGroups, onNavigate }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  const results = useMemo(() => {
    const items = navGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
    const term = query.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) => item.label.toLowerCase().includes(term))
  }, [navGroups, query])

  if (!open) return null

  function handleSelect(to) {
    onNavigate(to)
    onClose()
  }

  return (
    <div className="dialog-scrim fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center bg-scrim pt-24" onClick={onClose}>
      <div
        className="card dialog-panel w-full max-w-lg overflow-hidden bg-base-900 shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Search size="sm" className="shrink-0 text-text-secondary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'Enter' && results[0]) handleSelect(results[0].to)
            }}
            placeholder="Jump to a page…"
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="shrink-0 rounded border border-slate-200 bg-base-800 px-1.5 py-0.5 font-sans text-2xs text-text-muted">
            Esc
          </kbd>
        </div>

        <div className="custom-scrollbar max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-text-secondary">No matches.</p>
          ) : (
            results.map(({ to, label, icon: Icon, group }) => (
              <button
                key={to}
                type="button"
                onClick={() => handleSelect(to)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-text-primary transition-colors duration-100 hover:bg-tint/[0.05]"
              >
                <Icon size="sm" className="shrink-0 text-brand-400" />
                <span className="flex-1 truncate">{label}</span>
                <span className="shrink-0 text-2xs text-text-muted">{group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
