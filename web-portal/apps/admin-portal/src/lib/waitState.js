import { useEffect, useSyncExternalStore } from 'react'

/**
 * Which waits are open right now — a server sync, a batch write, a callable
 * that takes a few seconds — so a surface outside the page that started one
 * (the sidebar's "Earn while you wait" slot) can tell a wait is happening
 * without every page threading a prop up through the shell.
 *
 * A module store rather than React context: the shell renders the sidebar
 * ABOVE the page that owns the wait, so a provider would have to wrap both and
 * re-render the whole tree on every begin and end. Here only the components
 * reading `useCurrentWait` re-render.
 */
const waits = new Map()
const listeners = new Set()
let seq = 0
let snapshot = null

function emit() {
  // The oldest open wait is the one worth describing: it has run longest, so it
  // is the likeliest to still be running when someone reads the label.
  const first = waits.values().next()
  snapshot = first.done ? null : first.value
  listeners.forEach((listener) => listener())
}

/** Opens a wait and returns the function that closes it. */
export function beginWait(label) {
  seq += 1
  const id = seq
  waits.set(id, { id, label, since: Date.now() })
  emit()
  return () => {
    if (waits.delete(id)) emit()
  }
}

/** Holds a wait open for exactly as long as `active` is true. */
export function useWaitWhile(active, label) {
  useEffect(() => (active ? beginWait(label) : undefined), [active, label])
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** `{ id, label, since }` for the oldest open wait, or null. */
export function useCurrentWait() {
  return useSyncExternalStore(subscribe, () => snapshot, () => null)
}
