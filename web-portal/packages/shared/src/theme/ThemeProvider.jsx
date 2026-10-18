import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import { flushSync } from 'react-dom'

/**
 * Theme state for both portals.
 *
 * THREE-STATE, NOT TWO. The stored preference is `'light' | 'dark' | 'system'`
 * and the resolved theme is only ever `'light' | 'dark'`. That distinction is
 * the whole point of "respects prefers-color-scheme by default": a user who
 * has never touched the toggle should follow their OS *and keep following it*
 * when it changes at sunset. Collapsing to a boolean on first mount would
 * silently pin them to whatever their OS happened to be at that moment.
 *
 * The class goes on <html>, not <body>, so `dark:` variants and the token
 * overrides in styles/index.css also reach anything portalled to document.body
 * — which in this codebase is every dropdown, tooltip, toast and modal.
 *
 * NOTE: index.html carries a duplicate of the resolution logic as a blocking
 * inline script. That duplication is deliberate; see the comment there. The
 * storage key and class names below are the contract between the two.
 *
 * DELIBERATELY NOT PORTAL-NAMESPACED. Everything else this app persists is
 * scoped per portal via shared/config/portal.js#portalKey, because it carries
 * session or role identity that must not leak between the two consoles. The
 * theme carries neither — it is a device preference, and a user who picks light
 * mode in the guardhouse wants light mode in admin too. Namespacing it would
 * also mean teaching the index.html pre-paint script to resolve the portal
 * before it can read the key, buying a flash of the wrong theme in exchange for
 * isolating a value that has nothing to isolate. (On the split dev ports the
 * two origins get separate copies regardless; that is a property of separate
 * origins, not a decision made here.)
 */

const STORAGE_KEY = 'monticello-theme'
const ThemeContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a <ThemeProvider>')
  return context
}

/**
 * Pins the whole app to one theme for as long as the calling component is
 * mounted, then hands control back.
 *
 * WHY THIS IS A PROVIDER-LEVEL OVERRIDE AND NOT A CLASS ON A WRAPPER DIV.
 * The light palette is declared in `@theme`, which emits plain custom
 * properties on `:root`; `.dark` overrides them on <html>. Custom properties
 * INHERIT, so a `<div className="light">` inside a dark document declares
 * nothing and inherits the dark values — the div renders dark. The only ways
 * to pin a subtree light are to duplicate the entire light palette under a
 * `.light` selector (two palettes to keep in sync, which is how they drift) or
 * to change what is on <html>. This does the second.
 *
 * It deliberately does NOT touch the stored preference. A dark-mode
 * administrator who signs in through the pinned-light login is still a
 * dark-mode administrator on the dashboard a moment later; only the resolved
 * theme is overridden, and only while the pinning screen is on screen.
 *
 * Because `theme` in context reports the FORCED value, `isDark` and anything
 * branching on it are correct for what is actually painted. The consequence,
 * stated because it would otherwise be a puzzle: a theme toggle rendered
 * inside a pinned screen would write the preference and appear to do nothing.
 * No such screen has one, and a screen that pins a theme has no business
 * offering a control that contradicts it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useForcedTheme(forced) {
  const { setForcedTheme } = useTheme()

  // Layout effect, not effect: this runs in the same commit that mounts the
  // pinned screen, so the class swap below lands before the browser paints
  // rather than one frame into it. An effect here is a visible dark flash on
  // every client-side navigation into the login route.
  useLayoutEffect(() => {
    setForcedTheme(forced)
    return () => setForcedTheme(null)
  }, [forced, setForcedTheme])
}

// Queried as "is the OS dark?" rather than "is it light?" so that the fallback
// when matchMedia is unavailable — and the value the SSR/no-window branch
// returns — is LIGHT, which is the design system's canonical theme. See the
// Soft Modernism note at the top of styles/index.css.
const QUERY = '(prefers-color-scheme: dark)'

function readSystem() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia(QUERY).matches ? 'dark' : 'light'
}

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    // Private mode, or storage blocked by policy. Following the OS is a
    // better failure than throwing on mount.
    return 'system'
  }
}

export default function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStored)
  const [systemTheme, setSystemTheme] = useState(readSystem)
  // Set by useForcedTheme while a screen that pins a theme is mounted — today
  // only the admin sign-in, which is light by design and must stay light for a
  // dark-mode administrator. Null means "nobody is pinning"; the preference
  // below decides, exactly as before.
  const [forcedTheme, setForcedTheme] = useState(null)
  const firstRun = useRef(true)
  // True while a View Transition is painting the switch, so the per-element
  // fallback fade below stays off and the two never animate at once.
  const viewTransitionRef = useRef(false)

  const preferred = preference === 'system' ? systemTheme : preference
  const theme = forcedTheme ?? preferred

  // Keep following the OS while the preference is 'system'. The listener is
  // always attached rather than conditionally, so switching back to 'system'
  // picks up a change that happened while an explicit theme was set.
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = (event) => setSystemTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Layout effect so the class and `color-scheme` are on <html> before the
  // browser paints the commit that changed them. As a plain effect this is a
  // frame of the OUTGOING theme every time the resolved theme changes, which
  // is most visible entering and leaving the pinned-light sign-in screen.
  useLayoutEffect(() => {
    const root = document.documentElement

    // Skip the cross-fade on the very first run: index.html already resolved
    // and applied the theme, so there is nothing to fade FROM, and arming the
    // transition here would animate the entire first paint.
    if (!firstRun.current && !viewTransitionRef.current) root.classList.add('theme-switching')
    viewTransitionRef.current = false

    root.classList.remove('light', 'dark')
    root.classList.add(theme)
    root.style.colorScheme = theme

    if (firstRun.current) {
      firstRun.current = false
      return undefined
    }

    // Matches the 200ms in the .theme-switching rule, with a frame of slack.
    const timer = setTimeout(() => root.classList.remove('theme-switching'), 220)
    return () => clearTimeout(timer)
  }, [theme])

  useEffect(() => {
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Non-fatal: the theme still applies for this session.
    }
  }, [preference])

  // Toggling always writes an explicit preference. Someone who deliberately
  // picks light at midday does not want the OS overriding them at dusk.
  //
  // ── ONE CROSS-FADE, NOT A THOUSAND (2026-10-17) ─────────────────────────
  // The switch used to transition the colours of EVERY element for 200ms
  // (.theme-switching). Thousands of simultaneous transitions dropped frames,
  // and whatever cannot transition — gradients, images, the map canvas,
  // colour-mix() surfaces — snapped instantly while its neighbours faded, so
  // the page passed through mismatched half-light, half-dark frames.
  //
  // The View Transitions API snapshots the page, applies the change, and
  // cross-fades old frame to new as ONE composited layer (300ms, see
  // ::view-transition-* in styles/index.css). Nothing is laid out twice and
  // everything changes together. `flushSync` makes React commit the new class
  // inside the callback, which is when the API takes its "after" snapshot.
  // Browsers without the API, and reduced motion, keep the old path.
  const toggle = useCallback(() => {
    const flip = () =>
      setPreference((current) => {
        const resolved = current === 'system' ? readSystem() : current
        return resolved === 'dark' ? 'light' : 'dark'
      })
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (typeof document.startViewTransition !== 'function' || reduced) {
      flip()
      return
    }
    document.startViewTransition(() => {
      viewTransitionRef.current = true
      flushSync(flip)
    })
  }, [])

  const value = useMemo(
    () => ({
      /** Resolved: 'light' | 'dark'. What is actually on screen. */
      theme,
      isDark: theme === 'dark',
      /** Stored: 'light' | 'dark' | 'system'. Unaffected by a pin. */
      preference,
      setPreference,
      /** Hands control back to the OS. */
      useSystemTheme: () => setPreference('system'),
      toggle,
      /** For useForcedTheme only. Pass a theme to pin, null to release. */
      setForcedTheme,
    }),
    [theme, preference, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
