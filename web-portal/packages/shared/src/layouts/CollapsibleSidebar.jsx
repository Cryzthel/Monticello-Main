import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import BrandMark from '@shared/components/BrandMark'
import { Building2, LogOut, ShieldCheck, X } from '@shared/icons'
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

// The mark, sized to sit inside the 44px slot the rail is built around.
//
// This replaced an "MV" monogram on a `surface-brand` squircle. The monogram
// was a stand-in for artwork that did not exist yet; the artwork exists now
// (Figma node 271-71), so the tile goes with it — a coloured tile would have
// had to carry a mark in some other colour, and the brand's own lockup puts
// the mark directly on the surface with nothing behind it.
//
// `text-brand-logo` is the colour: the token alternates per theme, so the mark
// is #05171B on white here and #FFFDD7 in dark. The WORDMARK beside it takes
// the same token, so the lockup is one colour by construction rather than two
// values someone has to keep equal.
//
// `w-auto`, not `w-7`: the real artwork is a 192x179 viewBox — wider than it
// is tall — so a square box would letterbox it and render it shorter than the
// height asked for. Height is the only dimension set; the width follows.
//
// 24px, and this has been 36 → 28 → 24 → 32 → 24. The churn is worth one
// paragraph so the next person does not restart it.
//
// Every one of those rounds came in as "the mark renders black". It does not,
// and never did: it is the brand ink, confirmed by sampling painted pixels off
// screenshots, and that ink is a near-black that only shows its teal across
// enough solid area. 32px was a deliberate step UP to make the hue visible
// again, and it worked. 24px is a step back DOWN, by request, with the colour
// essentially unchanged — so the mark reads as near-black at this size. That is
// the expected outcome of the trade, not a regression to chase.
//
// If it should read teal at 24px, the lever is the ink, not this number:
// `--color-brand-logo` in styles/index.css. Size and colour are coupled here,
// and moving one without the other is what produced the churn.
//
// The slot it sits in is 44px wide and unchanged, so the mark does not fill it:
// ~10px of air either side. That air IS the lockup's optical gap here. It is
// not a `gap-*` utility, and deliberately — the slot's WIDTH is what animates
// on collapse, and a gap would be a second, unanimated space fighting it.
const BRAND_MARK = 'h-6 w-auto shrink-0 text-brand-logo'

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
    // below its content width, or the wordmark keeps its full width inside an
    // 80px rail and overflows it.
    //
    // The label gets 180px here (w-64, less px-4 and the 44px mark slot), and
    // 144px in the mobile drawer once the close button takes its 36px. Groote
    // sets "Monticello Villas" at 131px / 150px / 169px for 14 / 16 / 18px,
    // measured in the browser with the face actually loaded. 14px clears both
    // with room, which is what let the drawer branch go.
    //
    // Back to 14px after a brief spell at 16px, and this is the size that was
    // right all along: the rail is dense chrome, and a brand line bigger than
    // the 14px nav items beneath it makes the top of the panel heavy. It now
    // matches the login lockup exactly, so the brand reads at one size
    // everywhere instead of two.
    // `pb-4 border-b`: the lockup used to sit 12px (the column's `gap-3`) above
    // the first nav item, which read as the brand being the first entry in the
    // menu rather than the thing the menu belongs to. The rule is doing the
    // separating; the padding is what keeps the rule off the wordmark's
    // descenders. Together with the column gap that is 28px of air, which is
    // enough at the rail's density without spending a nav row's worth of height.
    //
    // It spans the padded content width when expanded and the full rail when
    // collapsed, because the container's `px-4` only applies in the former. That
    // difference is fine — collapsed, an edge-to-edge rule reads as a rail
    // divider, which is what it is.
    <div className="flex min-w-0 flex-1 items-center border-b border-hairline pb-4">
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
            className="h-6 w-6 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <BrandMark className={BRAND_MARK} />
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
        {/* 14px, and it stays 14px while the mark grows to 32px. The two are
            not locked together: the mark is competing with a 44px slot and the
            page beyond it, the label is competing with the 14px nav items
            directly beneath it, and a brand line larger than every item under
            it makes the rail top-heavy.

            It is also the size that fits everywhere without a branch. Measured
            in the browser with Groote loaded, "Monticello Villas" sets 131px
            at 14px, 150px at 16px, 169px at 18px. The desktop rail gives the
            label 180px (w-64, less px-4 and the 44px slot); the mobile drawer
            gives it 144px once the close button takes its 36px. 14px clears
            both. 16px briefly did not, which is why this once branched on
            `onClose` — that branch is gone, and a conditional that always
            evaluates the same way is worse than no conditional. */}
        <p className="truncate font-brand text-sm font-normal leading-tight tracking-tight text-brand-logo">
          Monticello Villas
        </p>
      </div>

      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Close navigation" className="icon-btn icon-btn-sm">
          <X size="sm" />
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
              {/* Colour is the only thing that changes between states — see
                  .nav-icon-glyph / -active in styles/index.css, which also
                  explains why the refill that used to live here is gone, and
                  why the `fill: transparent` that used to sit beside it had to
                  go when the icons became filled shapes.

                  `md` (20) is the nav step, and this is the fourth number it
                  has been: 18 (belonging to no scale), 24, 20 under a brief
                  asking for 20-22, 24 under one asking for 22-24, and now 20
                  under one asking for 18-20. The band has moved every time;
                  20 is the only value inside three of the four, which is the
                  argument for settling here.

                  It is also the value that matches the rest of the console:
                  20 is the action-button step, so a nav glyph and a toolbar
                  glyph are now the same size, and 24 was the only place in
                  either portal drawing icons larger than its own buttons.
                  Scale comes from shared/icons. */}
              <Icon
                size="md"
                className={`nav-icon-glyph ${isActive ? 'nav-icon-glyph-active' : ''}`}
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
          <Building2 size="sm" className="text-text-muted" />
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
              <ShieldCheck size="sm" className="shrink-0 text-brand-400" />
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
            <LogOut size="md" className="shrink-0" />
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
