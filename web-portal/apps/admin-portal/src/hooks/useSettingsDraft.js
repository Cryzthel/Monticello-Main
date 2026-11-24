import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Draft state for a settings form, committed by the page's Save button.
 *
 * Organisation preferences reach live guardhouse consoles the moment they are
 * written, so nothing auto-saves (the explicit-save decision, 2026-10-18).
 * `commit` coalesces: a save requested while one is in flight does not queue a
 * second write — it marks the draft dirty again and re-saves once the first
 * lands.
 *
 * ── WHEN SOMEONE ELSE SAVES FIRST ──────────────────────────────────────────
 * The saved value arrives live. With no edits, the form simply takes it. With
 * edits, the draft is kept — throwing away someone's changes because a
 * colleague saved is worse than a conflict — and `remoteChanged` is raised so
 * the page can say so and offer Discard.
 *
 * @param {object} args
 * @param {object} args.value   The saved values (a new object when they change).
 * @param {(draft: object) => Promise<void>} args.onSave
 */
export function useSettingsDraft({ value, onSave }) {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [remoteChanged, setRemoteChanged] = useState(false)

  const baseRef = useRef(value)
  const draftRef = useRef(draft)
  draftRef.current = draft
  // A commit asked for while one is in flight. Firestore writes are not
  // instant, and a switch flipped twice in a second must not become two
  // racing writes whose arrival order decides the stored value.
  const againRef = useRef(false)
  const savingRef = useRef(false)
  /**
   * The last draft this form successfully wrote.
   *
   * ── WHY "DIRTY" NEEDS TWO REFERENCE POINTS ─────────────────────
   * `value` is the STORE's copy, which only updates when Firestore echoes the
   * write back through the snapshot listener. Between the write landing and
   * the echo arriving, the draft differs from `value` — so a form that
   * measures dirtiness against `value` alone reports unsaved changes for a
   * change it has just saved.
   *
   * Under an explicit Save button that was invisible: the button had already
   * been pressed and the footer said "Saving…". With auto-save the status
   * line is the only feedback there is, and having it sit on "not saved yet"
   * after a successful write is precisely the thing that makes people
   * distrust auto-save.
   *
   * So a draft is clean if it matches EITHER the store or the last thing we
   * wrote. Both are true statements of "this is saved".
   */
  const savedDraftRef = useRef(null)

  useEffect(() => {
    const previous = baseRef.current
    baseRef.current = value
    if (sameValue(previous, value)) return

    const current = draftRef.current
    if (sameValue(current, value)) {
      // Our own save coming back, or someone saving what we already have.
      setRemoteChanged(false)
    } else if (sameValue(current, previous)) {
      setDraft(value)
      setRemoteChanged(false)
    } else {
      setRemoteChanged(true)
    }
  }, [value])

  const dirty = !sameValue(draft, value) && !sameValue(draft, savedDraftRef.current)

  /**
   * Apply a patch to the draft.
   *
   * ── THE REF IS UPDATED EAGERLY, AND THAT IS WHAT MAKES AUTO-SAVE WORK ─
   * `draftRef` was only assigned during render, which was fine when the only
   * thing that read it was a Save button pressed in a later tick. It is not
   * fine now: a switch calls `update` and then `commit` in the SAME handler,
   * and React has not re-rendered in between — so `save` read the draft from
   * before the change, found it equal to the saved value, and wrote nothing.
   * Measured: flipping a switch saved nothing at all.
   *
   * Assigning the ref here makes it mean "what would be written if we saved
   * right now", which is what every caller already assumed it meant. The
   * render-time assignment below is then a no-op that keeps the two in step
   * when the draft is replaced wholesale (a remote update, or Discard).
   */
  const update = useCallback((patch) => {
    setError(null)
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraft(next)
  }, [])

  const reset = useCallback(() => {
    draftRef.current = baseRef.current
    setDraft(baseRef.current)
    setError(null)
    setRemoteChanged(false)
  }, [])

  /**
   * Write the draft.
   *
   * Reads `draftRef`, never the `draft` closure: a control that updates and
   * commits in the same tick would otherwise save the value from BEFORE its
   * own change, because the re-render has not happened yet.
   *
   * Dirtiness is checked against `baseRef` for the same reason — the `dirty`
   * computed above is a render-time value and is stale inside a handler that
   * has just called `update`.
   */
  const save = useCallback(async () => {
    // Against the store AND the last write, for the reason on savedDraftRef.
    if (
      sameValue(draftRef.current, baseRef.current) ||
      sameValue(draftRef.current, savedDraftRef.current)
    ) {
      return false
    }
    if (savingRef.current) {
      // Fold into the save already running rather than starting a second.
      againRef.current = true
      return false
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const written = draftRef.current
      await onSave(written)
      savedDraftRef.current = written
      setSavedAt(Date.now())
      setRemoteChanged(false)
      return true
    } catch (err) {
      setError(describeSaveError(err))
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
      if (againRef.current) {
        againRef.current = false
        // Whatever changed while the last write was in flight.
        saveRef.current?.()
      }
    }
  }, [onSave])

  // So the `finally` above can re-enter the latest `save` without making it
  // depend on itself.
  const saveRef = useRef(null)
  saveRef.current = save

  return { draft, update, dirty, saving, error, savedAt, remoteChanged, save, reset }
}

export function describeSaveError(err) {
  switch (err?.code) {
    case 'permission-denied':
      return 'Not saved: this account may not change these preferences, or the settings rules have not been deployed yet.'
    case 'unavailable':
      return 'Not saved: the database cannot be reached. Check the connection and try again.'
    default:
      return err?.message ? `Not saved: ${err.message}` : 'Not saved. Try again.'
  }
}

/** Structural equality for small plain objects. */
function sameValue(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false
  }
  return true
}
