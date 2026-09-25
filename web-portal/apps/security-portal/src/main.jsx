import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LucideProvider } from 'lucide-react'
import ThemeProvider from '@shared/theme/ThemeProvider'
import '@/styles/index.css'
import App from '@/app/App'

/*
 * Guardhouse Portal entry point.
 *
 * Inter and JetBrains Mono load from Google Fonts via the <link> in
 * index.html — nothing to import here.
 *
 * LucideProvider sets ONE stroke weight for every icon in the app: 1.75px,
 * per the 2026-09-17 redesign brief. It was 1.5, chosen when the flat pass
 * moved the canvas to a high-contrast white and a 2px line read as heavy;
 * 1.75 sits between the two. Lucide ships 2 as its default, so this is still
 * a deliberate override rather than an agreement.
 *
 * Setting it here rather than per-icon
 * means a glyph added to a new screen next month is correct by default instead
 * of correct only if whoever adds it remembers the prop. A `strokeWidth` on an
 * individual icon still wins. `size` is intentionally NOT set: this codebase
 * sizes icons with Tailwind `h-` and `w-` utility classes, and the prop would
 * fight them.
 *
 * ThemeProvider sits outside the router and the error boundary on purpose: a
 * crashed route should still render its fallback in the user's chosen theme.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <LucideProvider strokeWidth={1.75}>
        <App />
      </LucideProvider>
    </ThemeProvider>
  </StrictMode>,
)
