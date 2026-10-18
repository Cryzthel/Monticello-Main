/**
 * The Settings page's column: a readable measure with generous space between
 * sections (Miller's law — four chunks the eye can find without reading).
 * The sticky title and Save bar above it is the shell's own page header
 * (`stickyHeader` on AppShell), so it shares the page's real <h1>.
 */
export default function SettingsLayout({ children }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 pb-16">{children}</div>
}
