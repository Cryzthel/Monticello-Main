import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

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
  const firstRun = useRef(true)

  const theme = preference === 'system' ? systemTheme : preference

  // Keep following the OS while the preference is 'system'. The listener is
  // always attached rather than conditionally, so switching back to 'system'
  // picks up a change that happened while an explicit theme was set.
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = (event) => setSystemTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement

    // Skip the cross-fade on the very first run: index.html already resolved
    // and applied the theme, so there is nothing to fade FROM, and arming the
    // transition here would animate the entire first paint.
    if (!firstRun.current) root.classList.add('theme-switching')

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
  const toggle = useCallback(() => {
    setPreference((current) => {
      const resolved = current === 'system' ? readSystem() : current
      return resolved === 'dark' ? 'light' : 'dark'
    })
  }, [])

  const value = useMemo(
    () => ({
      /** Resolved: 'light' | 'dark'. What is actually on screen. */
      theme,
      isDark: theme === 'dark',
      /** Stored: 'light' | 'dark' | 'system'. */
      preference,
      setPreference,
      /** Hands control back to the OS. */
      useSystemTheme: () => setPreference('system'),
      toggle,
    }),
    [theme, preference, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
