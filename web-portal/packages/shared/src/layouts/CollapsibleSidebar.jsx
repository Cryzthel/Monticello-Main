import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Building2, LogOut, ShieldCheck, X } from 'lucide-react'
import Tooltip from '@shared/components/Tooltip'
import { useSystemSettings } from '@shared/lib/systemSettingsStore'

/**
 * The sidebar for both portals — rail and mobile drawer.
 *
 * ANIMATION MODEL
 * ---------------
 * Nothing here unmounts on collapse. Labels stay in the tree and are squeezed
 * out by their own `flex-1` box as the rail's width animates, then faded so
 * they are never legible mid-squeeze. That is the difference between this and
 * a `{!collapsed && <span/>}` conditional: the conditional produces a hard
 * pop at the start of the transition, because the text vanishes a frame before
 * the width has moved at all.
 *
 * Three timings, all sharing one curve (--ease-spring in styles/index.css):
 *
 *   width / padding   300ms  ease-spring   the rail itself
 *   icon slot width   300ms  ease-spring   keeps the glyph from sliding
 *   label opacity     150ms out, 200ms in with a 100ms delay
 *
 * The asymmetry on the label is the part that sells it: collapsing fades the
 * text away FIRST and then narrows; expanding widens FIRST and only then fades
 * the text back in. Symmetric timing makes text appear to bleed through the
 * panel edge in both directions.
 *
 * This is CSS rather than Framer Motion on purpose — `width` is a layout
 * property, so it is recalculated on the main thread by either library, and
 * this project deliberately keeps animation out of JS (see the note above the
 * @keyframes block in styles/index.css re: bundle size).
 */

// Fixed-width icon column. See the .nav-icon comment in styles/index.css for
// why these two numbers are what they are.
function slotWidth(collapsed) {
  return collapsed ? 'w-14' : 'w-11'
}

function labelMotion(collapsed) {
  return collapsed ? 'opacity-0 duration-150' : 'opacity-100 delay-100 duration-200'
}

// The wordmark's squircle tile — the same geometry as .icon-tile, so the
// brand lockup and the lead glyphs in the nav below read as one family.
// brand-600 rather than brand-500 for the same reason .btn-brand is: this is
// a pale label sitting ON emerald, so it needs the AA-safe step.
const BRAND_MARK =
  'surface-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold'

/**
 * Sidebar header: logo and wordmark.
 *
 * The collapse trigger is deliberately NOT here. It lives in TopHeader, beside
 * the page title — a control whose job is "bring this panel back" should not
 * be mounted inside the panel it restores, where it has to survive an 80px
 * rail and vanishes entirely below `lg`. Anchoring it to the header makes its
 * position independent of whatever the sidebar is doing.
 */
function SidebarHeader({ collapsed, onClose }) {
  const logoUrl = useSystemSettings((state) => state.values.organisation.logoUrl)

  // A URL an administrator typed is a URL that can 404, expire, or point at a
  // host that blocks hotlinking — and the one place that must never show a
  // broken-image glyph is the chrome that frames every page. One failure
  // retires the logo for the session and the "MV" mark takes over, which is
  // exactly what renders when no logo is set at all.
  const [logoFailed, setLogoFailed] = useState(false)
  useEffect(() => setLogoFailed(false), [logoUrl])
  const showLogo = Boolean(logoUrl) && !logoFailed

  return (
    // `min-w-0 flex-1`, NOT shrink-0: this row has to be allowed to squeeze
    // below its content width, or the wordmark keeps its full 156px inside an
    // 80px rail and overflows it.
    <div className="flex min-w-0 flex-1 items-center">
      <span
        className={`${slotWidth(collapsed)} flex shrink-0 items-center justify-center transition-[width] duration-300 ease-spring`}
      >
        {showLogo ? (
          <img
            src={logoUrl}
            alt=""
            onError={() => setLogoFailed(true)}
            // `object-contain` on a square tile: a wordmark is usually wider
            // than it is tall, and `cover` would crop it to initials.
            className="h-9 w-9 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <span className={BRAND_MARK}>MV</span>
        )}
      </span>

      {/* One wordmark, no role tag.
          The second line used to print "Admin Portal" / "Guardhouse Portal"
          under the estate name. It was removed deliberately: the two consoles
          are different URLs with different navigation and different data, so
          nobody reaching one is in any doubt which they are in — the tag
          restated the obvious in the one place that frames every screen.

          The `brandLabel` prop went with it rather than being left accepted
          and ignored. Nothing else read it, and a prop threaded through three
          layouts to reach a line that no longer exists is a trail the next
          person has to walk before finding out it goes nowhere. */}
      <div className={`nav-label ${labelMotion(collapsed)}`}>
        <p className="truncate text-sm font-semibold leading-tight text-text-primary">Monticello Villas</p>
      </div>

      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Close navigation" className="icon-btn icon-btn-sm">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

function Avatar({ user }) {
  const initial = (user?.displayName || user?.email || 'A').charAt(0).toUpperCase()
  if (user?.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full border border-tint/10 object-cover"
      />
    )
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-400 ring-1 ring-inset ring-brand-500/25">
      {initial}
    </span>
  )
}

function NavItem({ to, label, icon: Icon, count, collapsed, onNavigate }) {
  return (
    <Tooltip label={label} disabled={!collapsed}>
      <NavLink
        to={to}
        onClick={onNavigate}
        // The visible text is faded out when collapsed, so without this the
        // link has no accessible name at all on the rail.
        aria-label={collapsed ? label : undefined}
        className={({ isActive }) => `nav-link group ${isActive ? 'nav-link-active' : ''}`}
      >
        {({ isActive }) => (
          <>
            <span className={`nav-icon ${slotWidth(collapsed)}`}>
              {/* THE REFILL. Inactive rows draw clean slate-400 line art;
                  active and hovered rows fill the glyph's paths with their own
                  colour so the icon gains mass rather than merely changing hue.

                  Both halves live in CSS (.nav-icon-glyph / -active in
                  styles/index.css) rather than as conditional classes here,
                  because the hover half has to be driven by the ROW's hover
                  state — `group-hover:fill-*` cannot express "fill with a
                  translucent mix of the current colour", and Lucide's
                  `fill="none"` presentation attribute has to be beaten by a
                  real CSS property either way.

                  Stroke weight comes from <LucideProvider> in main.jsx. */}
              <Icon
                className={`nav-icon-glyph h-[1.125rem] w-[1.125rem] shrink-0 ${
                  isActive ? 'nav-icon-glyph-active' : ''
                }`}
              />
              {/* Collapsed, the numeric badge has nowhere to sit, so the count
                  degrades to a dot pinned on the glyph. The signal survives a
                  narrowed rail even though the number doesn't. */}
              {count > 0 && collapsed ? (
                <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-base-900" />
              ) : null}
            </span>

            <span className={`nav-label ${labelMotion(collapsed)}`}>{label}</span>

            {/* The collapsed branch zeroes the box as well as the opacity.
                Fading alone leaves a 32px invisible element in flow, which
                overflows an 80px rail — clipped and harmless to look at, but
                it makes the row's scrollWidth lie about its contents. The two
                branches supply mr/min-w/px between them so no two conflicting
                utilities ever land in the same class string. */}
            {count > 0 ? (
              <span
                className={`flex h-5 shrink-0 items-center justify-center rounded-full bg-pill-danger text-2xs font-semibold tabular-nums text-pill-danger-fg transition-opacity ${
                  collapsed
                    ? 'w-0 overflow-hidden opacity-0 duration-150'
                    : 'mr-3 min-w-5 px-1.5 opacity-100 delay-100 duration-200'
                }`}
              >
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </>
        )}
      </NavLink>
    </Tooltip>
  )
}

function SidebarNav({ navGroups, badgeCounts, collapsed, onNavigate }) {
  return (
    <nav className="custom-scrollbar -mr-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {navGroups.map((group, groupIndex) => (
        <div key={group.label ?? `group-${groupIndex}`}>
          {group.label ? (
            // Fixed height, faded rather than removed: reserving the 1rem when
            // collapsed keeps the groups visually separated AND means the nav
            // column doesn't reflow vertically as the rail animates.
            <div className="mb-1 h-4 overflow-hidden px-3">
              <p className={`nav-group-label transition-opacity ${labelMotion(collapsed)}`}>{group.label}</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            {group.items.map((item) => (
              <NavItem
                key={item.to}
                {...item}
                count={badgeCounts?.[item.to] ?? 0}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

/**
 * Account footer: who is signed in, on which role, and the way out.
 *
 * Lives at the bottom of the sidebar rather than the top-right of the header
 * because that is where an operator looks for it — and because the header on
 * these dashboards is already carrying the page title, the search trigger and
 * the live alert bell.
 */
/**
 * The HOA office, for the person who needs to reach it at 02:00.
 *
 * ── WHY IT IS HERE AND NOT ON THE SIGN-IN PAGE ──────────────────────────────
 * The obvious home for a contact line is the sign-in screen, and it cannot go
 * there: `system_settings/operations` is readable by `isStaff()`, so a signed
 * out browser cannot read it at all. Anything rendered from these values has
 * to live inside the authenticated shell.
 *
 * Renders nothing when neither field is set, rather than an empty card with a
 * heading — an administrator who has not filled this in has not thereby asked
 * for a blank panel in every console.
 */
function SidebarOffice({ collapsed }) {
  const contactEmail = useSystemSettings((state) => state.values.organisation.contactEmail)
  const officeHours = useSystemSettings((state) => state.values.organisation.officeHours)
  if (!contactEmail && !officeHours) return null

  return (
    <Tooltip label={contactEmail || 'HOA office'} hint={officeHours || undefined} disabled={!collapsed}>
      <div className="nav-link cursor-default py-2 hover:bg-transparent">
        <span className={`nav-icon ${slotWidth(collapsed)}`}>
          <Building2 className="h-4 w-4 text-text-muted" />
        </span>
        <span className={`nav-label ${labelMotion(collapsed)}`}>
          {contactEmail ? (
            <a
              href={`mailto:${contactEmail}`}
              className="block truncate text-2xs font-medium leading-tight text-text-primary hover:underline"
            >
              {contactEmail}
            </a>
          ) : (
            <span className="block truncate text-2xs font-medium leading-tight text-text-primary">HOA office</span>
          )}
          {officeHours ? (
            <span className="mt-0.5 block truncate text-2xs leading-tight text-text-secondary">{officeHours}</span>
          ) : null}
        </span>
      </div>
    </Tooltip>
  )
}

function SidebarFooter({ user, roleLabel, collapsed, onLogout }) {
  const email = user?.email ?? 'Signed in'

  return (
    <div className="shrink-0 border-t border-hairline pt-3">
      <SidebarOffice collapsed={collapsed} />
      <Tooltip label={email} hint={roleLabel} disabled={!collapsed}>
        <div className="nav-link cursor-default py-2 hover:bg-transparent">
          <span className={`nav-icon ${slotWidth(collapsed)}`}>
            <Avatar user={user} />
          </span>
          <span className={`nav-label ${labelMotion(collapsed)}`}>
            <span className="block truncate text-xs font-medium leading-tight text-text-primary">{email}</span>
            <span className="mt-0.5 flex items-center gap-1 text-2xs leading-tight text-text-secondary">
              <ShieldCheck className="h-3 w-3 shrink-0 text-brand-400" />
              {roleLabel}
            </span>
          </span>
        </div>
      </Tooltip>

      <Tooltip label="Sign out" disabled={!collapsed}>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Sign out"
          className="nav-link hover:bg-danger/10 hover:text-danger"
        >
          <span className={`nav-icon ${slotWidth(collapsed)}`}>
            <LogOut className="h-[1.125rem] w-[1.125rem] shrink-0" />
          </span>
          <span className={`nav-label ${labelMotion(collapsed)}`}>Sign out</span>
        </button>
      </Tooltip>
    </div>
  )
}

export default function CollapsibleSidebar({
  roleLabel,
  navGroups,
  badgeCounts,
  user,
  onLogout,
  /** Rail only. The drawer is always expanded. Toggled from TopHeader. */
  collapsed = false,
  /** Drawer only — renders a close control in the brand row. */
  onClose,
  /** Drawer only — dismiss after routing. */
  onNavigate,
  /** Render prop mounted above the account footer — see DashboardLayout. */
  sidebarSlot,
  variant = 'rail',
}) {
  const isRail = variant === 'rail'

  return (
    <aside
      className={
        // Crisp white rail against the pastel canvas, separated by the
        // delicate emerald hairline rather than the old translucent wash —
        // at 60% white over a green canvas the sidebar read as a third
        // surface tone that exists nowhere else in the system.
        isRail
          ? `hidden shrink-0 flex-col gap-3 overflow-hidden border-r border-hairline bg-base-900 py-3 transition-[width,padding] duration-300 ease-spring lg:flex ${
              collapsed ? 'w-20 px-3' : 'w-64 px-4'
            }`
          : 'relative flex h-full w-64 shrink-0 flex-col gap-3 overflow-hidden border-r border-hairline bg-base-900 px-4 py-3'
      }
    >
      <div className="flex shrink-0 items-center">
        <SidebarHeader collapsed={collapsed} onClose={onClose} />
      </div>


      <SidebarNav
        navGroups={navGroups}
        badgeCounts={badgeCounts}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />

      {sidebarSlot ? sidebarSlot({ collapsed: isRail && collapsed }) : null}

      {/* The collapse trigger is in TopHeader, not in here — see SidebarHeader. */}
      <SidebarFooter user={user} roleLabel={roleLabel} collapsed={collapsed} onLogout={onLogout} />
    </aside>
  )
}
