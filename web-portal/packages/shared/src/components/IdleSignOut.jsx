import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '@shared/components/ConfirmDialog'
import { useAuth } from '@shared/auth/AuthContext'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'

/**
 * Signs an idle administrator out, after the window Settings › Security sets.
 *
 * ── WHY THIS IS A REAL CONTROL AND NOT A POLICY NOTE ───────────────────────
 * Almost everything on the Settings page that wants to enforce something needs
 * a Cloud Function, and Functions cannot deploy on the Spark plan — which is
 * why so many rows there carry a "stored, not yet acted on" note. A session
 * timeout is the exception: the thing being guarded is a BROWSER TAB, the
 * browser is where the guarding has to happen, and `signOut` is a client call.
 * So this one is enforced the moment it is saved, with no backend at all.
 *
 * What it is NOT is a security boundary. An attacker at the keyboard can stop
 * the timer by moving the mouse, and a stolen ID token stays valid for its
 * hour whatever this does. It answers the ordinary case this console actually
 * has: an administrator leaves a machine logged in, in an office other people
 * walk through, with write access to policy, staff accounts and resident
 * records. Firebase's token refresh is what makes a session last for weeks;
 * this is what ends one that nobody is using.
 *
 * ── THE WARNING IS NOT A COURTESY ──────────────────────────────────────────
 * The last 60 seconds are spent asking. Without it this component would
 * silently discard a half-written announcement or an unsaved settings draft —
 * "idle" means no pointer and no keys, and someone reading a long incident
 * description on screen is idle by that definition and is not away from their
 * desk. The dialog is the difference between a timeout and a trap.
 *
 * ── WHAT COUNTS AS ACTIVITY ────────────────────────────────────────────────
 * Pointer, keyboard, scroll and touch, plus the tab becoming visible again.
 * All passive listeners on the window, so none of them can delay a scroll.
 *
 * Deliberately NOT a timer per event: resetting a `setTimeout` on every
 * mousemove is thousands of timer churns a minute. A single timestamp is
 * written instead, and one interval checks it — see `tick`.
 *
 * ── MOUNTED BY THE ADMIN CONSOLE ONLY ──────────────────────────────────────
 * The guardhouse console is a shared terminal whose whole job is to sit
 * watching a map with nobody touching it. Idle is its normal state, and
 * signing it out would take the SOS siren off the air. See the note on
 * `security` in systemSettingsStore.js.
 */

/** How long the warning dialog is up before the session actually ends. */
const WARN_MS = 60_000

/** How often the idle timestamp is checked. Cheap, and never on an event. */
const TICK_MS = 5_000

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']

export default function IdleSignOut() {
  const { user, logout } = useAuth()
  const minutes = useSystemSettings((state) => state.values.security.sessionTimeoutMinutes)

  // `armed` is the whole gate: no signed-in user, or a timeout of 0, and this
  // component registers nothing and runs nothing.
  const armed = Boolean(user) && minutes > 0
  const idleMs = minutes * 60_000

  const [warning, setWarning] = useState(false)
  const lastActiveRef = useRef(Date.now())
  // Read inside the interval so the tick does not have to be re-created — and
  // so dismissing the warning cannot race a tick that was already scheduled.
  const warningRef = useRef(false)
  warningRef.current = warning

  const staySignedIn = useCallback(() => {
    lastActiveRef.current = Date.now()
    setWarning(false)
  }, [])

  // ── ACTIVITY ─────────────────────────────────────────────────────────────
  // Only while armed AND not warning. Once the dialog is up, a stray mousemove
  // must not silently cancel it: the administrator has been asked a question
  // and the answer is a button, not a twitch. (The dialog takes focus, so the
  // keyboard route out of it is the button too.)
  useEffect(() => {
    if (!armed || warning) return undefined
    const mark = () => {
      lastActiveRef.current = Date.now()
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, mark, { passive: true })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') mark()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, mark)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [armed, warning])

  // ── THE CLOCK ────────────────────────────────────────────────────────────
  // One interval for both edges. A wall-clock comparison rather than a
  // countdown, so a laptop that was asleep for an hour is signed out on the
  // first tick after it wakes instead of resuming a timer from where the lid
  // closed.
  useEffect(() => {
    if (!armed) {
      setWarning(false)
      return undefined
    }
    lastActiveRef.current = Date.now()
    const id = setInterval(() => {
      const idleFor = Date.now() - lastActiveRef.current
      if (idleFor >= idleMs) {
        logout()
      } else if (idleFor >= idleMs - WARN_MS) {
        if (!warningRef.current) setWarning(true)
      }
    }, TICK_MS)
    return () => clearInterval(id)
  }, [armed, idleMs, logout])

  if (!armed) return null

  /**
   * "Stay signed in" is the CANCEL slot, and "Sign out now" the confirm one.
   * That reads backwards for a second and is the right way round:
   * ConfirmDialog moves focus to Cancel so that a stray Enter lands on the
   * SAFE option, and here the safe option is the one that does not throw away
   * an unsaved draft. Someone who has actually walked away presses nothing and
   * the clock runs out regardless — the dialog only has to be right for the
   * person who is still at the desk.
   */
  return (
    <ConfirmDialog
      open={warning}
      tone="warning"
      title="Still there?"
      message={`This console signs out after ${minutes} minutes without activity. You are about to reach that. Anything you have typed and not saved will be lost.`}
      confirmLabel="Sign out now"
      cancelLabel="Stay signed in"
      onConfirm={logout}
      onCancel={staySignedIn}
    />
  )
}
