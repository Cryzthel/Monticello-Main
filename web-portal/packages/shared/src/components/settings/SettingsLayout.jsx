/**
 * The Settings page's column: a readable measure holding one card per
 * section (Miller's law — four chunks the eye can find without reading), 24px
 * apart. The sticky title and Save bar above it is the shell's own page header
 * (`stickyHeader` on AppShell), so it shares the page's real <h1>.
 */
export default function SettingsLayout({ children }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-16">{children}</div>
}
