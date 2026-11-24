import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ThemeProvider from '@shared/theme/ThemeProvider'
import '@/styles/index.css'
import App from '@/app/App'

/*
 * Admin Portal entry point.
 *
 * Inter and JetBrains Mono load from Google Fonts via the <link> in
 * index.html — nothing to import here.
 *
 * There is no icon provider here any more, and that is not a regression.
 *
 * `<LucideProvider strokeWidth={1.75}>` used to wrap this tree so that one
 * stroke weight reached every glyph in the app. There is no weight to set now:
 * the icons are Material Symbols, which are filled shapes whose weight is
 * baked in at export (wght=400) rather than applied at render. What a provider
 * used to guarantee is instead guaranteed by packages/shared/src/icons, where
 * every glyph is bound once, on one grid, at one size scale.
 *
 * The difference matters at the edges. A provider only covers what renders
 * inside it, so an icon drawn into a portal, a detached toast or a `document`-
 * level overlay escaped it; a glyph bound at the registry cannot escape.
 *
 * ThemeProvider sits outside the router and the error boundary on purpose: a
 * crashed route should still render its fallback in the user's chosen theme.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
