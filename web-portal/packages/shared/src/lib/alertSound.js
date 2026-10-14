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

/**
 * Every oscillator currently scheduled, so a stop can silence SOUND and not
 * merely cancel a timer.
 *
 * ── THE DOUBLE-RINGTONE BUG LIVED IN THIS GAP ──────────────────────────────
 * `loopAlert`'s stop used to clear its `setTimeout` and nothing else. The
 * timer is the schedule; it is not the noise. A panic wail is 2.6 seconds of
 * already-scheduled oscillator, so stopping the loop left that wail sounding
 * to its natural end — and anything that restarted the loop inside those 2.6
 * seconds laid a second wail directly on top of the first.
 *
 * Which is exactly what happened on every new alert: the siren effect
 * restarted whenever the SET of alerts changed, so two alerts arriving in
 * quick succession (one Firestore snapshot each) produced two overlapping
 * sirens, at double gain, slightly out of phase. That is the "double
 * ringtone".
 *
 * Both halves are fixed. The caller no longer restarts on set changes (see
 * usePanicSiren), and a stop now actually stops, so even a restart cannot
 * stack.
 */
const voices = new Set()

/**
 * Silence everything currently sounding.
 *
 * ── A SHORT RELEASE, NOT AN IMMEDIATE STOP ─────────────────────────────────
 * `osc.stop()` on a running oscillator truncates the waveform mid-cycle, which
 * is audible as a click — the same reason the chime and siren builders ramp
 * their gain in rather than switching it on. 40ms is below the threshold where
 * a listener hears it as a fade and above the one where it clicks.
 */
export function stopAlerts() {
  if (!ctx) return
  const now = ctx.currentTime
  voices.forEach(({ osc, gain }) => {
    try {
      gain.gain.cancelScheduledValues(now)
      // `setValueAtTime` at the CURRENT value first: cancelling leaves the
      // param wherever the last ramp put it, and ramping from an unset value
      // jumps before it fades.
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.04)
      osc.stop(now + 0.05)
    } catch {
      // Already stopped, or the context went away underneath us. Either way
      // there is nothing left to silence.
    }
  })
  voices.clear()
}

/** Registers a voice and forgets it once it has finished on its own. */
function trackVoice(osc, gain) {
  const voice = { osc, gain }
  voices.add(voice)
  osc.onended = () => voices.delete(voice)
}
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
export function playAlert(kind = 'report', { volume = 1, fromLoop = false } = {}) {
  if (muted) return

  /**
   * ── AN EMERGENCY OUTRANKS EVERY OTHER SOUND ON THE CONSOLE ───────────────
   *
   * This is the other half of the double-ringtone report, and it is not the
   * loop stacking on itself — that was fixed by making `loopAlert` a
   * singleton. It is two DIFFERENT sounds arriving together.
   *
   * `useIncidentAlerts` is mounted in DashboardLayout, which means every page
   * of both portals plays a chime when an incident appears or changes; and
   * `DispatchWatchdog` plays its own 'critical' chime on a new assignment and
   * on the acknowledgement timeout. A resident pressing SOS commonly produces
   * an incident write as well as a panic alert, and dispatching that alert
   * fires the watchdog — so a single emergency could put a looping siren, a
   * report chime and a dispatch chime on one AudioContext within a second of
   * each other. Three overlapping tones is heard as one broken noise, and the
   * one carrying "somebody has pressed a panic button" is the one that gets
   * lost in it.
   *
   * So while the siren is looping, every other sound is dropped. Not queued —
   * dropped: a chime replayed after an emergency ends is an announcement about
   * something that happened minutes ago, and the console has a notification
   * bell and a toast for that. Sound is reserved for the loudest thing that is
   * true right now.
   *
   * `fromLoop` is how the loop plays its own wail through this guard. A flag
   * rather than a separate code path, so the siren still honours mute, volume
   * and the suspended-context recovery below exactly as every other sound
   * does.
   */
  if (!fromLoop && isLooping()) return
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

/**
 * How long one `kind` takes to sound, in milliseconds.
 *
 * Derived from the pattern rather than written down beside it, so a wail that
 * is re-tuned cannot leave a repeat interval behind describing the old one.
 */
export function alertDurationMs(kind = 'report') {
  const p = PATTERNS[kind] ?? PATTERNS.report
  if (p.kind === 'siren') return Math.round(p.cycles * p.sweep * 2 * 1000)
  return Math.round(p.freqs.length * (p.pulse + p.gap) * 1000)
}

/**
 * Sound `kind` over and over until the returned function is called.
 *
 * ── A REPEATED WAIL, NOT AN ENDLESSLY-RUNNING OSCILLATOR ───────────────────
 * The obvious reading of "loop the ringtone" is one oscillator that never
 * stops. It is the wrong shape here for two reasons.
 *
 * The first is safety. An oscillator with no scheduled `stop` outlives every
 * bug in the code that was supposed to end it — a component that unmounts
 * oddly, a thrown error between `start` and the cleanup — and what it leaves
 * behind is a guardhouse console screaming with no UI attached to it. A wail
 * that stops on its own every few seconds cannot do that: the worst failure is
 * one extra sweep.
 *
 * The second is that a real alarm is not a continuous tone. The gap is what
 * makes it possible to talk over — a guard answering the radio call the alarm
 * just caused needs to be heard, and a siren that never pauses competes with
 * the response it exists to trigger.
 *
 * So this re-triggers the finite, already-tested wail on a timer. It also
 * sounds the FIRST one immediately rather than after a gap: an alarm whose
 * first audible moment is one interval late is an alarm that was late.
 *
 * @returns {() => void} Stops the loop. Safe to call more than once.
 */
export function loopAlert(kind = 'panic', { volume = 1, gapMs = 900 } = {}) {
  /**
   * ── ONE LOOP, MODULE-WIDE ─────────────────────────────────────────────
   * Starting a loop stops whatever was already looping, so the invariant is
   * structural rather than a rule every caller has to remember. React alone
   * breaks that rule twice without trying: StrictMode mounts effects, tears
   * them down and mounts them again in development, and any second component
   * that ever calls this would be a second alarm with no way to find the
   * first.
   *
   * The guard is the module's, not the caller's, because the thing being
   * protected is the single AudioContext every voice is scheduled on.
   */
  stopLoop()

  let stopped = false
  let timer = null

  const beat = () => {
    if (stopped) return
    playAlert(kind, { volume, fromLoop: true })
    // Scheduled from the END of the wail, so the gap is a gap rather than an
    // overlap — `setInterval` at a shorter period than the sound would stack
    // wails on top of each other and climb in volume.
    timer = setTimeout(beat, alertDurationMs(kind) + Math.max(0, gapMs))
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    // The schedule AND the sound. Clearing only the timer is what let a
    // restart stack a second wail on one still sounding — see `voices`.
    stopAlerts()
    if (activeLoop === stop) activeLoop = null
  }

  activeLoop = stop
  beat()
  return stop
}

/** The stop function of the loop currently running, or null. */
let activeLoop = null

/** Ends the running loop, if any. Safe to call when nothing is playing. */
export function stopLoop() {
  if (activeLoop) activeLoop()
}

/** Is a loop sounding right now? Exposed for tests and for a mute indicator. */
export function isLooping() {
  return activeLoop !== null
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
    trackVoice(osc, gain)
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
  trackVoice(osc, gain)
  osc.start(now)
  osc.stop(end + 0.03)
}
