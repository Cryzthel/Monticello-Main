import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Edit-then-save state for a settings form.
 *
 * Organisation preferences reach live guardhouse consoles the moment they are
 * written, so nothing here auto-saves: the form holds a DRAFT, shows what is
 * unsaved, and commits only on Save.
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

  const dirty = !sameValue(draft, value)

  const update = useCallback((patch) => {
    setError(null)
    setDraft((current) => ({ ...current, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setDraft(baseRef.current)
    setError(null)
    setRemoteChanged(false)
  }, [])

  const save = useCallback(async () => {
    if (!dirty) return false
    setSaving(true)
    setError(null)
    try {
      await onSave(draftRef.current)
      setSavedAt(Date.now())
      setRemoteChanged(false)
      return true
    } catch (err) {
      setError(describeSaveError(err))
      return false
    } finally {
      setSaving(false)
    }
  }, [dirty, onSave])

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
