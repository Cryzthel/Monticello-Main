import SegmentedControl from '@shared/components/SegmentedControl'

/**
 * The shell both Settings pages are built in: a section list beside the panels.
 *
 * ── WHY A SIDEBAR AND NOT THE ROW OF TABS THIS REPLACES ────────────────────
 * The Admin page reached this shape first, as a horizontal `SegmentedControl`
 * in `kind="tabs"` mode, and it solved the real problem — seven groups down one
 * scroll was a page you read rather than a console you operate.
 *
 * A horizontal track has one flaw that gets worse as a console grows: every
 * section has to fit on one line, so the labels get compressed to whatever the
 * narrowest viewport allows and start lying about what is inside them. A
 * vertical list has a column's worth of room, which is why nearly every
 * settings surface of this size uses one.
 *
 * It also puts the two things an operator compares — where they are, and what
 * is on screen — side by side rather than above and below.
 *
 * ── AND WHY THE TABS COME BACK ON A PHONE ──────────────────────────────────
 * Below `lg` the sidebar would be a full-width list of four links stacked on
 * top of the settings, pushing the actual controls off the first screen. So the
 * same sections render as the horizontal control there. One component, two
 * presentations of one list, and nothing for the two pages to disagree about.
 *
 * ── IT OWNS THE NAVIGATION, NOT THE CONTENT ────────────────────────────────
 * `children` is whatever the page decides to mount for the active section.
 * Both pages keep their own group-rendering, their own draft state and their
 * own save semantics — Admin's are substantial and nothing here should know
 * about them. What is shared is the frame.
 */

/**
 * @param {object}   props
 * @param {Array<{value: string, label: string, icon?: Function, count?: string}>} props.sections
 * @param {string}   props.active
 * @param {Function} props.onChange
 * @param {React.ReactNode} [props.aside]  Rendered under the nav — a save bar,
 *   a status note. Sticky with it on a console, after the content on a phone.
 */
export default function SettingsLayout({ sections, active, onChange, aside = null, children }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      {/* ── THE NAV COLUMN ──────────────────────────────────────────────
          `lg:sticky` so a section list does not scroll away from the settings
          it navigates — on a page whose longest section runs well past one
          screen, that is the difference between a console and a document.

          ── `top-6`, NOT THE HEADER'S HEIGHT ──────────────────────────────
          The first version offset this by `--app-header-h`, reasoning that a
          sticky element has to clear the app bar. It does not, and the result
          was a nav sitting 64px BELOW the first panel at rest — measured, not
          theorised.

          Sticky resolves against the nearest scrolling ancestor, and in this
          shell that is DashboardLayout's `<main>`, which is `overflow-y-auto`
          and begins *below* the header already. Adding the header's height to
          an offset inside it counts the same bar twice. 24px is the page's own
          gutter, so the nav rests level with the panel beside it and parks one
          gutter down once it starts to travel.

          `self-start` is load-bearing: a grid item stretches to the row's
          height by default, and `position: sticky` on a full-height box has
          nothing to travel within, so it simply never sticks. */}
      <div className="lg:sticky lg:top-6 lg:col-span-1 lg:self-start">
        {/* ── TWO CONTROLS, ONE LIST, AND THAT IS DELIBERATE ─────────────
            `SegmentedControl` is not made vertical here. Its selected pill is
            a clip-path measured from the buttons' own rectangles — the trick
            that recolours each label at the pixel the pill's edge crosses it —
            and that geometry is horizontal. Teaching it a second axis would
            put a second measuring path through the one component fourteen
            other surfaces render, to serve one page.

            So the phone keeps the real segmented control, and the console gets
            a plain list of links, which is what a vertical settings nav is
            anyway. Only one is ever mounted, so a screen reader meets one set
            of tabs rather than two. */}
        <div className="lg:hidden">
          <SegmentedControl
            options={sections}
            value={active}
            onChange={onChange}
            ariaLabel="Settings sections"
            kind="tabs"
            size="lg"
            fullWidth
          />
        </div>

        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="flex flex-col gap-1">
            {sections.map((section) => {
              const Icon = section.icon
              const current = section.value === active
              return (
                <li key={section.value}>
                  <button
                    type="button"
                    onClick={() => onChange(section.value)}
                    aria-current={current ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-[background-color,color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
                      current
                        ? 'bg-brand-100 text-brand-400'
                        : 'text-text-secondary hover:bg-tint/[0.05] hover:text-text-primary'
                    }`}
                  >
                    {Icon ? <Icon size="sm" aria-hidden="true" className="shrink-0" /> : null}
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    {/* The unsaved-changes dot the Admin page sets. It has to
                        live on the nav, because tabs can hide an edit: change
                        a field, switch section, and the save bar insists
                        something is pending with nothing on screen to show
                        for it. */}
                    {section.count ? (
                      <span
                        aria-label="Unsaved changes"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                      />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
        {aside ? <div className="mt-4 hidden lg:block">{aside}</div> : null}
      </div>

      {/* ── THE PANELS ───────────────────────────────────────────────────
          `min-w-0` so a long hotline number or a wide control shrinks the
          column instead of pushing the grid wider than the page — the default
          `auto` minimum is what lets a flex or grid child refuse to compress. */}
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
        {children}
        {aside ? <div className="lg:hidden">{aside}</div> : null}
      </div>
    </div>
  )
}
