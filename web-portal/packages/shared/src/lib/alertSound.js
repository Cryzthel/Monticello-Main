/**
 * Audible alerting for the guardhouse console.
 *
 * ── WHY SYNTHESISED AND NOT AN MP3 ────────────────────────────────────────
 * The tones are generated with WebAudio oscillators rather than shipped as
 * audio files. A guardhouse console runs for a whole shift on whatever the
 * subdivision's connection is doing that day, and an <audio src="alert.mp3">
 * that 404s or is still downloading is a silent alert — the exact failure the
 * feature exists to prevent. An oscillator has nothing to fetch, nothing to
 * cache, and works the first time the page loads offline.
 *
 * ── THE AUTOPLAY PROBLEM, WHICH IS THE WHOLE DIFFICULTY ───────────────────
 * Chrome and Safari refuse to let a page produce sound until the user has
 * interacted with it. A console left open on a wall-mounted monitor that
 * nobody has clicked is therefore MUTE, with no error, no warning, and no way
 * for the guard to know. That is worse than having no sound feature at all,
 * because staff will come to rely on it.
 *
 * So this module treats "can we actually make noise" as observable state
 * (`blocked`) rather than assuming success, and the UI is expected to show it.
 * `unlock()` needs a real user gesture; `installGestureUnlock()` below wires
 * that to the first interaction anywhere in the app, so no dedicated button is
 * required. The Settings page still exposes mute and a manual "Test sound".
 */

const STORAGE_KEY = 'mv.guard.alertSound.muted'

/**
 * Distinct signatures, so a guard can tell what happened without looking.
 *
 * ── WHY `panic` IS NOT JUST A LOUDER `critical` ───────────────────────────
 * These used to be one key. `critical` was described as "Panic / SOS", but the
 * only thing that ever played it was `useIncidentAlerts`, on any new report
 * marked high or critical priority — which on a busy day is several an hour.
 * An actual panic button press made no sound at all.
 *
 * They are separate now because they have to survive being heard together. A
 * siren that also fires for every high-priority maintenance report is a siren
 * the guardhouse stops hearing within a week, and at that point it is not a
 * siren, it is furniture. `panic` is reserved for the SOS button and nothing
 * else.
 */
const PATTERNS = {
  // ── PANIC / SOS ─────────────────────────────────────────────────────────
  // A police-style two-tone wail, not a chime. A chime is a notification —
  // something you register and finish reading a sentence before acting on. A
  // rising-and-falling sweep is an ALARM: the pitch never settles, so the ear
  // cannot habituate to it the way it does to a repeated fixed tone, and it
  // keeps demanding attention for as long as it runs.
  //
  // Sawtooth, because harmonics are what carry a sound across a room with a
  // radio and a fan running. A triangle wave at the same amplitude is politely
  // inaudible over ambient guardhouse noise. The lowpass keeps it piercing
  // without the ice-pick fizz cheap desk speakers add on top.
  //
  // ~2.6s over four sweeps: long enough that a guard looking away still turns
  // around, short enough not to talk over the radio call that follows.
  panic: {
    kind: 'siren',
    low: 620,
    high: 1240,
    sweep: 0.33,
    cycles: 4,
    gain: 0.3,
    wave: 'sawtooth',
    cutoff: 3200,
  },
  // A high/critical-priority REPORT. Three rising pulses — urgent, and
  // clearly not the siren.
  critical: { kind: 'chime', freqs: [880, 1046, 1318], pulse: 0.16, gap: 0.09, gain: 0.32 },
  // A new incident report. Two calm notes — this needs attention, not alarm.
  report: { kind: 'chime', freqs: [660, 880], pulse: 0.13, gap: 0.07, gain: 0.22 },
  // Status change on an existing incident. One soft note.
  update: { kind: 'chime', freqs: [740], pulse: 0.11, gap: 0, gain: 0.16 },
}

let ctx = null
let muted = readMuted()
let blocked = true // assume blocked until a successful unlock proves otherwise
const listeners = new Set()

function readMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Private mode / storage disabled. Default to AUDIBLE: a guard who cannot
    // persist a preference should still be alerted.
    return false
  }
}

function emit() {
  listeners.forEach((fn) => fn({ muted, blocked }))
}

/** Subscribe to {muted, blocked}. Returns an unsubscribe. */
export function subscribeAlertSound(fn) {
  listeners.add(fn)
  fn({ muted, blocked })
  return () => listeners.delete(fn)
}

export function isMuted() {
  return muted
}

export function setMuted(next) {
  muted = next
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    // Preference is lost on reload; the session still honours it.
  }
  emit()
}

/**
 * Unlocks on the FIRST user gesture anywhere in the app, automatically.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * There used to be a "Sound on / Muted / Enable sound" button in the guardhouse
 * header, and its real job was not muting — it was being the user gesture the
 * browser demands before a page may make noise. Removing that button therefore
 * could not be a pure deletion: with nothing calling `unlockAlertSound()` from
 * a gesture, the console would have run silently all shift, which is the exact
 * failure this module's header comment says is worse than having no sound at
 * all.
 *
 * So the gesture requirement is satisfied without spending header space on it.
 * A guard clicking anything — a nav item, a table row, a key — arms the audio,
 * which in practice means it is armed within seconds of the shift starting and
 * the operator never had to be told about a browser policy.
 *
 * `once: true` on each listener and a `capture` phase registration: this must
 * not depend on the event reaching any particular handler, and it must cost
 * nothing after the first gesture. `pointerdown` rather than `click` because a
 * drag or a long-press is also a gesture, and Safari counts it.
 *
 * A wall-mounted console nobody ever touches is still silent, and that is not
 * solvable from script — the Settings page keeps a "Test sound" button, which
 * is both the manual unlock and the way to prove the speakers work.
 */
function installGestureUnlock() {
  if (typeof document === 'undefined') return
  const events = ['pointerdown', 'keydown', 'touchstart']
  const arm = () => {
    events.forEach((type) => document.removeEventListener(type, arm, true))
    // Fire and forget: a failure leaves `blocked` true, which the Settings
    // page still reports, and the next gesture is not re-armed because a
    // browser that refused this one will refuse the next for the same reason.
    unlockAlertSound()
  }
  events.forEach((type) => document.addEventListener(type, arm, { capture: true, once: true }))
}

installGestureUnlock()

/**
 * Creates or resumes the AudioContext. MUST be called from a user gesture the
 * first time, or the browser will leave the context suspended.
 */
export async function unlockAlertSound() {
  try {
    const AudioCtx = window.AudioContext ?? window.webkitAudioContext
    if (!AudioCtx) {
      blocked = true
      emit()
      return false
    }
    ctx ??= new AudioCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    blocked = ctx.state !== 'running'
    emit()
    return !blocked
  } catch (err) {
    console.warn('Could not start the alert audio context', err)
    blocked = true
    emit()
    return false
  }
}

/**
 * Plays one alert.
 *
 * Never throws and never awaits anything the caller depends on — this is fired
 * from inside a Firestore snapshot handler, and an audio failure must not take
 * the listener (or the visual toast that accompanies it) down with it.
 */
/**
 * @param {string} kind
 * @param {{ volume?: number }} [options] `volume` is 0-1 and scales the
 *   pattern's own gain. It is passed IN rather than read from the settings
 *   store so this module stays dependency-free and directly testable — the
 *   guardhouse hands it the configured level, the Settings page hands it the
 *   level being previewed.
 */
export function playAlert(kind = 'report', { volume = 1 } = {}) {
  if (muted) return
  const level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
  if (level === 0) return
  const base = PATTERNS[kind] ?? PATTERNS.report
  const pattern = { ...base, gain: base.gain * level }

  try {
    if (!ctx || ctx.state !== 'running') {
      // Try a silent resume in case the context was suspended by a tab
      // backgrounding rather than by the autoplay policy. If it was the
      // policy, this no-ops and `blocked` stays true for the UI to show.
      unlockAlertSound()
      if (!ctx || ctx.state !== 'running') return
    }

    const now = ctx.currentTime
    if (pattern.kind === 'siren') playSiren(pattern, now)
    else playChime(pattern, now)
  } catch (err) {
    console.warn('Alert sound failed to play', err)
  }
}

/** Discrete notes — the notification signatures. */
function playChime(pattern, now) {
  pattern.freqs.forEach((freq, i) => {
    const start = now + i * (pattern.pulse + pattern.gap)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    // Triangle rather than sine: it carries further through the ambient noise
    // of a guardhouse (radio, fans, traffic) without the harshness of a saw.
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, start)

    // A hard start/stop on a gain node clicks audibly. These ramps are the
    // difference between a chime and a pop.
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(pattern.gain, start + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + pattern.pulse)

    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + pattern.pulse + 0.02)
  })
}

/**
 * One continuous tone whose pitch sweeps up and down — the SOS alarm.
 *
 * ONE oscillator for the whole wail, not one per sweep. Restarting an
 * oscillator at each turning point puts a discontinuity in the waveform, which
 * is audible as a click on every rise and fall and turns a siren into a
 * stutter. Scheduling ramps on a single running oscillator is what makes the
 * pitch bend continuously, the way a real one does.
 */
function playSiren(pattern, now) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()

  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(pattern.cutoff, now)

  osc.type = pattern.wave
  osc.frequency.setValueAtTime(pattern.low, now)

  let at = now
  for (let i = 0; i < pattern.cycles; i += 1) {
    osc.frequency.linearRampToValueAtTime(pattern.high, at + pattern.sweep)
    at += pattern.sweep
    osc.frequency.linearRampToValueAtTime(pattern.low, at + pattern.sweep)
    at += pattern.sweep
  }
  const end = at

  // Held flat between attack and release rather than decaying like the chimes:
  // an alarm that fades while it is still sounding reads as ending, and a
  // guard stops turning toward it.
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(pattern.gain, now + 0.04)
  gain.gain.setValueAtTime(pattern.gain, Math.max(now + 0.05, end - 0.12))
  gain.gain.exponentialRampToValueAtTime(0.0001, end)

  osc.connect(filter).connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(end + 0.03)
}
