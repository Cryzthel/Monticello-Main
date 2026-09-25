/**
 * Decides whether an incoming set of panic alerts should sound the alarm.
 *
 * Pure, and separate from the hook that drives it, because this is the part
 * with the judgement in it — everything around it is a `useRef` and a
 * `useEffect`. Extracted so the rules below can be exercised directly instead
 * of only through a rendered component.
 *
 * `seen` is null before the first pass and a Set thereafter. Callers hold it;
 * this returns the next one alongside the decision.
 *
 * `ready` is whether `ids` came from a real snapshot. It is load-bearing — see
 * below.
 */
export function panicSirenStep(seen, ids, ready = true) {
  // ── DO NOT PRIME FROM A PLACEHOLDER ───────────────────────────────────────
  //
  // This is the fix for the alarm firing when the Dispatch Map merely opened.
  //
  // `useLiveCollection` starts every subscription at `data: []`, so the hook's
  // first pass ran against an EMPTY array and recorded 'I have seen nothing'.
  // A moment later the real snapshot arrived carrying whatever alerts were
  // already open, none of which were in that empty set — so every one of them
  // read as newly received and the siren went off on page load. The louder the
  // alarm was made, the worse that got.
  //
  // An empty array before the query resolves and an empty array because there
  // are genuinely no alerts are indistinguishable from the data alone. `ready`
  // is the only thing that can tell them apart, so until it is true this
  // returns `seen` UNCHANGED — still null, still unprimed — rather than
  // recording a snapshot that has not happened.
  if (!ready) return { seen, ring: false }

  // ── FIRST REAL SNAPSHOT IS SILENT ─────────────────────────────────────────
  // It carries every currently-open alert. Sounding the alarm for a two-hour-old
  // acknowledged alert because someone refreshed the page is how staff learn to
  // ignore the alarm — and an alarm staff ignore is worse than no alarm,
  // because it is trusted right up until it matters.
  if (seen === null) return { seen: new Set(ids), ring: false }

  // ── ONE ALARM PER BATCH ───────────────────────────────────────────────────
  // Not one per alert. Two alerts landing in the same snapshot would overlap
  // their three-pulse patterns into noise, and the guard's next action is the
  // same either way: look at the map.
  const ring = ids.some((id) => !seen.has(id))

  // Rebuilt rather than merged, so an alert that is resolved and later
  // reopened rings again. Dropping out of the array IS the signal that it
  // stopped being live, and a merged set would remember it forever.
  return { seen: new Set(ids), ring }
}
