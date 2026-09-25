---
name: Monticello Villas Consoles
description: Two calm corporate-SaaS consoles — Admin and Guardhouse — sharing one flat, dual-tone, mobile-aligned system.
colors:
  canvas: "#F5F6F8"
  surface: "#FFFFFF"
  surface-floating: "#FFFFFF"
  well: "#F1F5F9"
  kpi-shell: "#FAFBFC"
  hairline: "#E9ECF0"
  divider: "#F0F2F5"
  control-border: "#E2E8F0"
  control-border-hover: "#CBD5E1"
  cta: "#0F172A"
  cta-fg: "#FFFFFF"
  cta-hover: "#1E293B"
  brand-fill: "#047857"
  brand-ink: "#065F46"
  brand-wash: "#ECFDF5"
  brand-wash-active: "#D1FAE5"
  focus: "#047857"
  nav-active: "#ECFDF5"
  nav-active-fg: "#065F46"
  text-primary: "#0F172A"
  text-secondary: "#475569"
  text-muted: "#64748B"
  icon-inactive: "#94A3B8"
  success: "#15803D"
  warning: "#B45309"
  danger: "#B91C1C"
  info: "#0369A1"
  severity-high: "#9A3412"
  violet: "#5B21B6"
  sos-plate: "#B91C1C"
  sos-ink: "#FFFFFF"
  pill-success: "#ECFDF5"
  pill-success-fg: "#047857"
  pill-warning: "#FFFBEB"
  pill-warning-fg: "#B45309"
  pill-danger: "#FEF2F2"
  pill-danger-fg: "#B91C1C"
  pill-info: "#F0F9FF"
  pill-info-fg: "#0369A1"
  pill-high: "#FFF7ED"
  pill-high-fg: "#C2410C"
  pill-violet: "#F5F3FF"
  pill-violet-fg: "#6D28D9"
  pill-neutral: "#F1F5F9"
  pill-neutral-fg: "#475569"
  segmented-track: "#F1F5F9"
  segment-active: "#FFFFFF"
  segment-active-fg: "#0F172A"
  switch-knob: "#FFFFFF"
  chart-line: "#047857"
  chart-fill: "#A7F3D0"
  chart-neutral: "#CBD5E1"
  chart-axis: "#64748B"
  skeleton: "rgba(15, 23, 42, 0.09)"
  skeleton-muted: "rgba(15, 23, 42, 0.05)"
  scrim: "rgba(0, 0, 0, 0.58)"
typography:
  page-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.02em"
    fontFeature: "'tnum' 1"
  section-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  card-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.003em"
  control:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.005em"
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.005em"
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
  machine-data:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "'tnum' 1"
rounded:
  surface: "12px"
  control: "8px"
  segment: "6px"
  pill: "9999px"
spacing:
  hairgap: "2px"
  shell: "4px"
  tight: "8px"
  cell-y: "12px"
  dense: "16px"
  card: "20px"
  rhythm: "24px"
components:
  button-primary:
    backgroundColor: "{colors.cta}"
    textColor: "{colors.cta-fg}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.cta-hover}"
    textColor: "{colors.cta-fg}"
  button-sm:
    backgroundColor: "{colors.cta}"
    textColor: "{colors.cta-fg}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
    typography: "{typography.control}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.pill-danger}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    typography: "{typography.body}"
  search-trigger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.surface}"
    padding: "20px"
  card-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    padding: "12px 16px"
    typography: "{typography.card-title}"
  kpi-shell:
    backgroundColor: "{colors.kpi-shell}"
    rounded: "{rounded.surface}"
    padding: "4px"
  kpi-face:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
  data-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
  dialog-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
  segmented-track:
    backgroundColor: "{colors.segmented-track}"
    rounded: "{rounded.control}"
    padding: "2px"
  segment-active:
    backgroundColor: "{colors.segment-active}"
    textColor: "{colors.segment-active-fg}"
    rounded: "{rounded.segment}"
    padding: "6px 12px"
    typography: "{typography.control}"
  status-pill:
    backgroundColor: "{colors.pill-neutral}"
    textColor: "{colors.pill-neutral-fg}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "24px"
    typography: "{typography.control}"
  status-pill-sm:
    backgroundColor: "{colors.pill-neutral}"
    textColor: "{colors.pill-neutral-fg}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "20px"
    typography: "{typography.caption}"
  chip-idle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
    typography: "{typography.control}"
  chip-active:
    backgroundColor: "{colors.pill-success}"
    textColor: "{colors.pill-success-fg}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  nav-link:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    height: "32px"
    typography: "{typography.body}"
  nav-link-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-fg}"
    rounded: "{rounded.control}"
  icon-tile:
    backgroundColor: "{colors.brand-wash}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.control}"
    size: "40px"
  switch-on:
    backgroundColor: "{colors.brand-fill}"
    rounded: "{rounded.pill}"
    width: "44px"
    height: "24px"
  sos-banner:
    backgroundColor: "{colors.sos-plate}"
    textColor: "{colors.sos-ink}"
    rounded: "{rounded.surface}"
---

# Design System: Monticello Villas Consoles

## Overview

**Creative North Star: "The Duty Desk"**

Two consoles that behave like instruments rather than marketing surfaces. A desk officer keeps the Guardhouse open for a whole shift and an administrator reads the Admin portal for an hour at a time, so the system's first commitment is that nothing moves, glows or shouts unless it is carrying information. The ground is a soft grey workspace; content sits on crisp white cards that declare their edges with a single hairline and a whisper of shadow; one emerald accent marks state, and one near-black marks action. Both themes are co-equal — light is compiled as the default and dark is a runtime override of the same token names, so no component branches on theme.

Density is high but not cramped. Figures are set in Inter with tabular figures so a column of counts aligns without a costume typeface; capsules carry read-only state; 8px rectangles are the things you operate. Depth is a two-tier ladder in the same direction in both themes — a surface that sits higher is lighter — and only layers genuinely floating above the page cast a real shadow. There is no glassmorphism, no blur, no translucent surface fill and no elevation modelling; every one of those was present in an earlier pass and was removed for measured reasons recorded in `packages/shared/src/styles/index.css`.

The palette is a deliberate port of the Flutter resident app's `AppColors`, because the phone and the guardhouse are one product. Where the shipped web value departs from mobile, it departs for a measured contrast reason and the stylesheet says which. That parity contract is the first thing to check if the two products ever look different again.

**Key Characteristics:**
- Flat, dual-tone, mobile-aligned: border plus a whisper defines a surface; real shadows are reserved for floating layers.
- One emerald accent at two lightnesses (#047857 light, #10B981 dark) for state, focus and charts; a near-black for action.
- Two shapes with two jobs: 12px boxes, 8px controls, capsules only for tokens you read.
- Inter for all language and all figures (with `tabular-nums`); JetBrains Mono for identifiers and machine data only.
- Sentence case everywhere; an `uppercase` utility in this codebase is a regression.
- Both themes measured to WCAG 2.1 AA; a solid single-value focus outline is the floor, not a per-component decision.

## Colors

A cool slate neutral field carrying one emerald accent, a near-black action ink, and a six-hue semantic set that only ever appears as a pastel capsule.

### Primary
- **Forest Emerald** (`{colors.brand-fill}`): the accent, and the only green in the system. It fills the switch's on-state, draws the focus outline, strokes the chart line, tints the leaf waiting mark, and inks active navigation. It does **not** fill buttons.
- **Deep Emerald Ink** (`{colors.brand-ink}`): the accent as *text* — active nav labels, lead-glyph tiles, inline accent links. The AA-safe step for a label on a pale wash.
- **Emerald Wash** (`{colors.brand-wash}`): the resting or selected row tint and the lead-glyph tile's plate. A solid step, not an alpha.
- **Emerald Wash, Active** (`{colors.brand-wash-active}`): one step up, for an active control fill — avatar fallbacks, pressed accent chrome.

### Secondary
- **Console Ink** (`{colors.cta}`, hover `{colors.cta-hover}`): action. Every primary button, the brand wordmark tile, the active segment's label. A corporate console's commit control is near-black, not coloured.

### Tertiary
- **Alarm Red** (`{colors.sos-plate}`): the guardhouse panic plate, on white ink (`{colors.sos-ink}`). The single element exempt from theming — it must mean the same thing in both.
- **The semantic six** (`{colors.success}`, `{colors.warning}`, `{colors.danger}`, `{colors.info}`, `{colors.severity-high}`, `{colors.violet}`): status, severity and category meaning. Each sits one step darker than its mobile counterpart because the web renders it as a wash under full-strength label ink, which costs roughly 1.3 stops a solid mobile chip does not pay.

### Neutral
- **Soft Grey Workspace** (`{colors.canvas}`): the app canvas — the ground white cards sit *on*. One step deeper than slate-50, so a card lifts by fill as well as by hairline.
- **Paper White** (`{colors.surface}`): every card, panel, dialog and rail. Solid and opaque, never translucent.
- **Recessed Well** (`{colors.well}`): inset inputs, code pills, the segmented track.
- **Whisper Hairline** (`{colors.hairline}`) and **Row Divider** (`{colors.divider}`): the lines that do the defining. The control border (`{colors.control-border}`, hover `{colors.control-border-hover}`) is one step stronger, because a field has to look operable.
- **Slate Ink Ladder** (`{colors.text-primary}` / `{colors.text-secondary}` / `{colors.text-muted}`): headings, body and metadata. `{colors.icon-inactive}` is non-text only — inactive nav strokes — because at small text sizes it fails AA.

### Named Rules
**The Action-Is-Not-Accent Rule.** Emerald never fills a button. Action is `{colors.cta}`; emerald means state — active nav, switch-on, success, focus, charts. If a new surface wants a green CTA, it wants the wrong token.

**The Pair Rule.** Any surface that fills with a colour and carries a label on it reads a *pair* token (`cta`/`cta-fg`, `nav-active`/`nav-active-fg`, `pill-x`/`pill-x-fg`), never a fill plus a hardcoded `text-white`. The correct foreground inverts between themes and a single literal cannot express that.

**The Solid-Wash Rule.** Brand tints are solid palette steps, not alphas. A resting or selected row is `{colors.brand-wash}`; an active control fill is `{colors.brand-wash-active}`. A `bg-brand-500/<alpha>` fill is drift — there are zero left in the build.

**The Mobile-Wins Rule.** When a brief and the Flutter app's `AppColors` disagree on a palette value, the mobile palette wins. Where the shipped web value departs from mobile it is a measured contrast correction and the token says so.

**The Theme-Invariant Alarm Rule.** The SOS plate and the modal scrim are the only elements exempt from theming — one must always mean danger, the other must always darken. Nothing else may opt out.

## Typography

**Display Font:** none. The largest type in the system is the 24px page title.
**Body Font:** Inter (with `ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, Roboto)
**Label/Mono Font:** JetBrains Mono (with `ui-monospace`, `SFMono-Regular`, Menlo, Consolas)

**Character:** One tall-x-height UI face doing all the talking, with a monospace reserved strictly for strings a human reads character-by-character. Letter-spacing is bound to each step of the scale rather than applied per component, so every `text-*` size is optically corrected automatically — tighter as it grows, slightly open at 10 and 11px.

### Hierarchy
- **Page title** (`{typography.page-title}`): the page naming itself, once, in `PageHeader`. Balanced text, bold, primary ink, with an optional 14px muted subtitle.
- **Figure** (`{typography.figure}`): the headline number on a KPI face. Inter with tabular figures, never mono — equal-width digits are what align "12,847" against "11,846".
- **Section title** (`{typography.section-title}`): `SectionHeading`, which sits *above* a panel, over a 14px muted description.
- **Card title** (`{typography.card-title}`): `CardHeader`, the header row *inside* a card, over a 12px muted line. One rank below the section title.
- **Body** (`{typography.body}`): every sentence, cell and field value. The working size of both consoles.
- **Label** (`{typography.label}`): a compact title inside a dense surface — toast and popover headlines, list-row names, notification titles.
- **Control** (`{typography.control}`): small-rank buttons, segments, chips, `md` badges, table column heads.
- **Caption** (`{typography.caption}`): metadata under a value — timestamps, hints, legend rows, `sm` badges.
- **Micro** (`{typography.micro}`): count pills, keyboard hints, the wordmark's role line. Semibold, because at 10px weight is the only thing keeping it legible.
- **Machine data** (`{typography.machine-data}`): ticket ids, badge numbers, log codes, credential slips.

### Named Rules
**The Sentence-Case Rule.** Nothing in either console is set in all caps. Page titles, section titles, table column heads, form labels and badges are sentence case at medium or semibold weight. An `uppercase` utility here is a regression — the retired `.eyebrow` class is kept in the stylesheet as a tombstone, not a declaration.

**The Figures-Are-Inter Rule.** Counts, timestamps, timers, deltas and pagination ranges are Inter with `tabular-nums`. Alignment is a numeric feature, not a typeface choice. `font-mono` on a figure is drift; `font-mono` on an *identifier* is the system. `font-variant-numeric: tabular-nums` is applied in the base layer to every `table`, every `.tabular` and every mono element, so a figure inside a table is already aligned.

**The Two-Header-Ranks Rule.** A header above a panel is `SectionHeading` (16px semibold over 14px muted). A header inside a card is `CardHeader` (14px semibold over 12px muted). Which one applies is decided by where the header sits, never by the page. Both set their supporting line in `text-muted`, one step *lighter* than the title — the rank must never invert, which is the exact drift `CardHeader` was created to stop.

## Layout

A fixed-height app shell: a `100dvh` flex row of rail plus content column, both `overflow-hidden`, so only the regions that should scroll do.

**The rail.** 256px expanded, 80px collapsed (`px-4` / `px-3`, `py-3`, `gap-3`), transitioning width over 300ms on the sprung curve. Nav groups are `gap-3` apart, items `gap-0.5`, and `.nav-link` is `py-1.5` — a 32px row. Measured: the full Admin nav fits without scrolling down to roughly a 630px-tall viewport. The collapse trigger lives in the top header, not the rail. Below `lg` the rail becomes a 256px drawer over a scrim.

**The header.** `min-h-16` wrapping, `sm:h-16` fixed, `px-4 sm:px-6`, on the canvas colour with a hairline below. It carries only what is identical on every page: the nav toggle, the page title at 16px, the search trigger (capped `max-w-xl`), the portal's primary action, theme, and alerts.

**The content column.** `max-w-[100rem]`, centred, `p-4 pb-10 sm:p-6 sm:pb-12`, `overflow-y-auto overscroll-contain` with the custom 6px scrollbar. `PageHeader` sits above the page's own box with `mb-6`.

**Grids.** `.page-grid` is 12 columns at a 24px gutter. `.kpi-grid` is 1 / 2 / 4 columns at `sm` and `xl`, dropping to 3 columns when exactly three cards are present.

**Scrolling.** `scroll-behavior: smooth` is declared on `html` and `.custom-scrollbar`, inside `prefers-reduced-motion: no-preference`. Table scroll bodies carry `pb-6` so the last row clears the viewport edge.

### Named Rules
**The Who-Owns-The-Scroll Rule.** `DashboardLayout` gives the children wrapper `min-h-0 flex-1` **only** when a page passes `scroll={false}`. A fixed-height workspace needs both classes so its inner regions scroll instead of pushing the column taller. A *scrolling* page must have neither: `min-h-0` lets a flex item shrink below its content, so the box stayed at viewport height around taller content — measured at 1280×800 as a 584px box around 1224px of content — and every bottom padding landed in the middle of the overflow. Dropping both restores the automatic minimum size; measured after, 48px of clearance at scroll end.

**The Two-Rhythms Rule.** There are exactly two vertical rhythms and they are not interchangeable. A **scrolling** page uses 24px gaps. A **fixed-height workspace** — anything whose root carries `h-full min-h-0` and scrolls inside its columns — uses 16px, because every 8px of gutter there is 8px taken from the queue. The test is `h-full` on the root; a scrolling page on 16px is drift.

**The Skeleton-Is-A-Reservation Rule.** A placeholder's height is the line height of the text it replaces (12px caption → 12px bar, 14px body → 16px bar, the KPI figure → 28px bar) and its container keeps the real layout's padding and gap. `SkeletonKpiCard` reuses `.kpi-shell` and `.kpi-face` with the real paddings for exactly this reason. A skeleton that does not match the real box guarantees the layout shift it exists to prevent. Two fills, not one: the block step stands in for substantive content, the muted step for the secondary line under it.

## Elevation & Depth

A hybrid, but tonal first. In-page depth is a 1px line plus a whisper: `--shadow-panel` (mobile's `AppShadows.sm`, black at ~4% in two short layers) sits under a hairline so a card's top edge does not dissolve where the border alone falls off. That pairing is the entire in-page depth budget — no gradients, no inset modelling, and no coloured glow under a CTA (`--shadow-brand*` resolve to `none`, kept only so their call sites don't error). Real shadows belong to layers genuinely stacked above the page: popovers, dropdowns, modals and drawers. Elevation direction is the same in both themes — higher is lighter — which is what lets the semantic token names (`base-950` canvas, `base-900` card, `base-800` well) mean the same thing in light and dark.

Stacking order is a single global fact, declared once because every floating layer portals into `document.body` and is therefore a sibling: overlay 100, modal 1000, popover 2000, toast 3000, SOS 4000. Popovers deliberately outrank modals — a `<Select>` opened inside a dialog must not paint behind it, which is a bug this project shipped and fixed. Use `z-[var(--z-popover)]`; never a bare number.

### Shadow Vocabulary
- **Panel** (`box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 2px 6px -1px rgba(15,23,42,.04)`): the resting whisper under a card, KPI face or data panel.
- **Hover** (`box-shadow: 0 2px 4px rgba(0,0,0,.05), 0 8px 24px -6px rgba(0,0,0,.10)`): the paired lift, on `.card-interactive` only.
- **Overlay** (`box-shadow: 0 4px 12px -2px rgba(15,23,42,.10), 0 2px 4px -2px rgba(15,23,42,.06)`): popovers, dropdowns, tooltips, map popups.
- **Modal** (`box-shadow: 0 20px 40px -12px rgba(15,23,42,.20), 0 4px 10px -4px rgba(15,23,42,.08)`): dialogs and drawers.
- **Contact hairline** (`box-shadow: 0 1px 2px rgba(15,23,42,.12)`): under a primary button; `.04` under an outline button and the search trigger; the active segment adds `inset 0 0 0 1px` of the segment ring over `0 1px 2px rgba(15,23,42,.06)`.

Dark mode reassigns all four to higher-opacity blacks (`.25`–`.40`) rather than inheriting the light values.

### Named Rules
**The Border-Is-The-Edge Rule.** A surface's edge is a drawn hairline; the shadow only keeps it from dissolving. If a new panel needs a shadow to be *findable*, its fill or its hairline is wrong.

**The Floating-Only-Casts Rule.** Only a layer genuinely above the page casts a real shadow. An in-page panel that casts one is claiming a stacking order it does not have.

**The Hover-Moves-The-Border Rule.** A hovered card darkens its edge one slate step and gains the hover whisper. It does **not** translate. A dense dashboard must not twitch as the pointer crosses it.

## Shapes

Two radii with two jobs, plus a capsule. Boxes are 12px (`rounded-xl`, compiled `--radius-xl: .75rem`): cards, data panels, KPI shells, popovers, toasts and every dialog panel. Controls are 8px (`rounded-lg`, compiled `--radius-lg: .5rem`): buttons, text inputs, search triggers, nav rows, lead-glyph tiles, the segmented track, and the KPI face. The individual segment inside a segmented control is 6px (`rounded-md`), so it nests inside its 8px track. Capsules (`rounded-full`) are status and category badges, count pills, trend pills, chips, switches, dots and avatars.

Borders carry the form: a hairline on surfaces, the one-step-stronger control border on anything operable, and `ring-1 ring-inset` at 10–15% of the label ink on a pastel capsule — enough to hold its edge on a white card without reading as an outline.

### Named Rules
**The Two-Tiers Rule.** 12 for boxes, 8 for controls. The surface tier moved down from 16px, so surfaces and the old "nested" tier are now the same value and the vocabulary is genuinely two steps. A radius chosen for looks rather than for tier is drift.

**The Capsule-Is-Read-Not-Pressed Rule.** `rounded-full` marks a thing you *read* as a token — a status, a count, a filter's on-state. Things you *operate* are 8px rectangles. A text input is never a capsule: the curve eats the first glyph, and on a textarea it resolves to half the height and clips the first and last lines. A `textarea.field` specificity rule enforces this permanently.

**The Concentric-Nesting Rule.** A nested radius equals the outer radius minus the gap between them. The KPI card is the reference: the shell is 12px with 4px of padding, so the face is 8px.

## Components

### Buttons
- **Shape:** 8px rectangle (`{rounded.control}`), sized by fixed **height** rather than vertical padding, so buttons in a row align regardless of label length.
- **Sizes:** `.btn-md` is 40px tall at `px-4`, the page-level standard; `.btn-sm` is 36px at `px-3.5` with control type and is the standard for dialog footers; `.btn-icon-md` / `.btn-icon-sm` are square at 44px / 36px.
- **Primary:** near-black plate under a white label (`{colors.cta}` / `{colors.cta-fg}`) with a 1px contact shadow; hover darkens one step.
- **Outline:** white on the control border; hover darkens the border and drops the fill to the well.
- **Semantic:** success / warning / danger are a 10% wash under full-strength ink inside a 25% border, deepening to 20% on hover.
- **Hover / Focus / Press:** 150ms on `--ease-out-strong`; press is `scale(0.97)`; focus is the base-layer outline, never a translucent ring.

### Chips
- **Style:** capsule, `px-3 py-1.5` at control type. Idle is white on the control border in secondary ink; hover darkens border and ink only, and is gated behind `(hover: hover) and (pointer: fine)` so a touch tap does not leave a stuck state.
- **State:** active is the success pill pair inside a 30% border of its own ink. Press is `scale(0.97)`.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** `{colors.surface}`; the KPI shell is the one off-white plate (`{colors.kpi-shell}`), so the white face inside it reads as raised.
- **Shadow Strategy:** the resting panel whisper under a hairline; `.card-interactive` adds the hover lift and is applied only where the card really answers the pointer.
- **Border:** `{colors.hairline}`, 1px.
- **Internal Padding:** 20px for a plain card; `CardHeader` is `px-4 py-3` with a hairline below; `.data-panel` is a clipped 12px box for tables and adds no padding of its own.

### Inputs / Fields
- **Style:** `.field` — full width, 8px, white, on the control border, `px-3 py-2` at body size, muted placeholder. Textareas take `py-2.5`.
- **Focus:** the border shifts to the accent and gains a 2px accent ring at 20%. This is the one deliberate translucent ring left in the system; every other control uses the solid outline.
- **Error / Disabled:** `aria-invalid="true"` recolours border and ring to danger; disabled drops to 60% opacity with a not-allowed cursor.

### Navigation
- **Style:** 8px rows, 32px tall (`py-1.5`), body size at medium weight in secondary ink, with a fixed-width icon column (44px expanded, 56px collapsed) so glyphs stay on one axis through the collapse.
- **Default / hover / active:** hover is a 4% ink wash; active is the emerald wash plate under deep-emerald ink. Icons are Lucide at 1.5px stroke and do **not** refill on active — the wash and the ink carry it. A group label is 12px muted; a badge count is a danger capsule with tabular figures; an unread marker is an 8px danger dot ringed in the surface colour.
- **Mobile:** below `lg`, a full-height 256px drawer over the scrim, dismissing on navigate.

### Badges
The portal's one capsule is `StatusBadge`, with `PriorityBadge` as a thin alias. Tone is resolved from *meaning* — status, severity or category — and never passed as a colour by the caller, which is how "Dispatched" stays the same blue on every screen. Fill, ink and ring come from one row of `BADGE_TONES`; geometry from one row of `BADGE_SIZES`, which uses fixed heights rather than vertical padding so badges of different labels share a baseline in a table row. A status badge carries a leading Lucide glyph, or a 6px dot where icons would crowd.

**The Badge-Rank Rule.** `md` (24px, 12px label, `px-3`) for every table row, feed row and list card — anything a reader scans down a column of. It is the default; pass nothing. `sm` (20px, 11px label) for dense chrome only: drawers, toasts, pickers, inline fields and dialog headers. `lg` (28px) exists for a badge used as a heading. Left to per-call-site judgement this drifted so badly that single rows showed two capsule heights side by side; 17 call sites were promoted to settle it, and the rule is recorded in `theme/badgeStyles.js`.

**The Two-Vocabularies Rule.** Incident categories and audit event categories are deliberately different icon vocabularies. `theme/categoryIcons.js` exports `categoryIcon`, `auditEventIcon`, `panicSignalIcon`, `residentStatusIcon` and `notificationIcon` as separate maps; do not fold one into another. Category tone resolves through `categoryTone()`, which lower-cases first, because Firestore values are not guaranteed lowercase and an unmatched category silently loses the one signal the colour exists to carry.

### Segmented Control
A well-coloured 8px track at 2px padding holding 6px segments at control type. The active segment is white with an inset ring and a contact shadow; the indicator is a separate absolutely-positioned layer whose `clip-path` transitions over 200ms on `--ease-slide`, so the pill travels rather than cross-fades. Idle hover is a 6% ink wash behind the fine-pointer gate. Focus is a 2px accent ring drawn on a `::after` inset by 3px so it clears the track. `segment-lg` steps the type up to body size; a `count-pill` inside a segment is a 16px capsule filled at 16% of the current ink.

### Dialogs
Nine dialogs share `max-h-[80dvh]` and **none sets a fixed height** — a dialog is as tall as its content, up to the ceiling. Width is a four-step ladder, read from source: the two form composers and the account provisioner are `max-w-2xl`; the announcement detail panel is `max-w-xl`; the credential, panic-alert and resolve dialogs are `max-w-lg`; the incident detail modal is `max-w-4xl`. Below `sm` a dialog squares off its bottom corners and meets the viewport edge as a sheet. Entry is `dialogIn` — 220ms, an 8px rise plus a 0.98 scale — over a fading scrim.

Rhythm differs by kind, and the difference is real: a **form composer** runs `px-6 py-3.5` header / `p-6 pb-8` body / `px-6 py-3` footer; a **detail panel** runs `px-5 py-4`. The one deliberate exception to all of the above is the dispatch drawer, fixed at `h-[88dvh]` on mobile because it is a bottom sheet, becoming a 416px right-hand rail at `lg`.

**The Focus-Goes-In-And-Comes-Back Rule.** Every `role="dialog"` surface routes through `useDialogFocus`: focus moves in on open (to a named `initialRef`, else the panel itself, which carries `tabindex="-1"`), Tab is contained inside the panel, and focus returns to the opener on close. Twelve of the thirteen dialog surfaces use it. `NotificationBell` is the one deliberate exclusion, because it is a popover rather than a modal and must not trap Tab.

### Tables
`.data-panel` is the clipped 12px box. `.table-head` is control type in muted ink at normal tracking, with `font-weight: inherit` on its cells so a `<th>` does not bolden itself. `.data-row` hovers to a 70% well wash over 150ms. Every long list ends in `TablePagination` — seven of them, six in the apps plus the shared incidents table — a hairline-topped `px-4 py-3` bar carrying a tabular "Showing *a*–*b* of *n*" range, a rows-per-page select, and 36px page buttons. Audit History's select-all is deliberately scoped to the *visible page*, because the action behind it is a bulk delete.

### Notifications
`buildNotificationFeed` takes an `audience` and a `viewerUid`. The audience is the build-time `__PORTAL__` define (`'admin'` / `'security'`), so each console compiles its own filter: admin sees escalated and dispatched work, security sees the open work queue, panic alerts reach **both** unconditionally, and an author is never notified of their own announcement. `NotificationRow` is a three-column grid — 28px glyph, flexible body, right-aligned time — carrying a category badge, a tabular timestamp over a micro date, a 13px semibold title, a two-line clamped detail, the location as a `sm` neutral badge with a pin glyph, and an explicit action button. An unread row is marked by a 6px accent dot in the gutter.

### Duty Status
`GuardStatusWidget` is the guardhouse's on/off-shift plate: solid `pill-success` / `pill-neutral` pairs rather than alphas, a `tabular-nums` shift timer, and a `ConfirmDialog` in front of clocking out, because ending a shift by mis-click is the one action here with no undo.

### The Leaf Mark (signature)
`LeafLoader.jsx` ports the resident phone app's waiting mark from `lib/core/widgets/leaf_loader.dart`, so a resident raising an SOS and the officer receiving it wait on the same object. The path is that widget's exact Bézier (`M12 0 Q24 4.32 12 24 Q0 4.32 12 0 Z` at 24×24, control points at 18% of height, which is what gives it full shoulders rather than a lens); the fill is a top-to-bottom gradient from the accent into itself at 55% alpha; motion is a 1100ms linear turn with `leafBreathe` layered over it, sampling `0.88 + 0.12·sin(t)` at its quarter points (0.88 → 1 → 0.88 → 0.76). The colour follows the accent **token**, not the phone's literal hex, so the mark moves in dark mode. `SessionLoader` is the mark alone, centred on the canvas, with an `sr-only` label kept in the accessibility tree for `role="status"` — no bar, no visible text. Under reduced motion the leaf holds still rather than disappearing, because a blank screen is the defect the component exists to prevent.

### Motion
Three curves, all in CSS, deliberately no animation library: `--ease-spring` `cubic-bezier(.32,.72,0,1)` for geometry that changes size (the rail collapse, the switch knob); `--ease-out-strong` `cubic-bezier(.23,1,.32,1)` for presses, popovers and dialog entrances; `--ease-slide` `cubic-bezier(.65,0,.35,1)` for the segmented indicator's travel. Durations are 150ms for state colour, 200–260ms for entrances, 300ms for the rail. `prefers-reduced-motion: reduce` kills every keyframe, flattens the press scales, and zeroes the switch and indicator transitions. A theme flip is a 200ms colour-only transition applied through a temporary `.theme-switching` class, itself disabled under reduced motion.

## Do's and Don'ts

### Do:
- **Do** express focus once: a 2px solid `{colors.focus}` outline at 2px offset, from the base-layer floor on every `a`, `button`, `summary`, `[role=button]`, `[role=tab]`, `[role=switch]` and tabbable element. A new control inherits it by being focusable and needs no focus classes at all.
- **Do** size buttons by fixed height (40px / 36px) so a row of them aligns whatever the labels say, and use `.btn-sm` in dialog footers.
- **Do** use `md` badges in anything with rows and `sm` only in dense chrome.
- **Do** read a pair token whenever you fill a surface and put a label on it.
- **Do** set figures — counts, timers, timestamps, deltas — in Inter with `tabular-nums`.
- **Do** put 12px on boxes and 8px on controls, and keep nested radii concentric (outer minus gap).
- **Do** give the children wrapper `min-h-0 flex-1` only when the page passes `scroll={false}`.
- **Do** reach for `z-[var(--z-*)]`, and remember popovers outrank modals.
- **Do** route every `role="dialog"` through `useDialogFocus`.

### Don't:
- **Don't** add `outline-none` to a focusable control. It was removed from `.btn`, `.chip`, `.switch`, `.segment` and `.icon-btn` along with their translucent rings, and it is the thing that breaks the focus floor.
- **Don't** fill anything with `bg-brand-500/<alpha>`. Use `{colors.brand-wash}` for a resting or selected tint and `{colors.brand-wash-active}` for an active control fill.
- **Don't** put emerald on a button, or near-black on a status.
- **Don't** set anything in all caps, and don't reintroduce a kicker or eyebrow line above a heading — the `.eyebrow` class is a tombstone in the stylesheet, and the retired uppercase tracked label is not a rank in this scale.
- **Don't** use `font-mono` for a count, timer, delta or timestamp. Mono is for identifiers and log strings only.
- **Don't** give an in-page panel a real shadow, a gradient, a blur, a translucent fill, or a hard offset shadow — none of those exist in this world, and each of the first four was measured out of an earlier pass.
- **Don't** draw an icon as a text glyph or an icon font. Icons are Lucide components at 1.5px stroke, or an inline SVG for the leaf.
- **Don't** give a dialog a fixed height, and don't invent a width outside the `lg` / `xl` / `2xl` / `4xl` ladder.
- **Don't** make a whole row the only way to act on a notification; give it an explicit action control.
- **Don't** add a `tailwind.config.js`. This is Tailwind v4 and the `@theme` block in `packages/shared/src/styles/index.css` is the config; a config file here is silently ignored.

## Known Limitations

Recorded as observed. These are defects the build carries, not rules for new surfaces to inherit.

- **Two button classes, one size.** `.btn-drawer` (`border px-3 py-1.5 text-xs`) and `.btn-compact` (`px-3 py-1.5 text-xs`) are identical sizing under two names, and both size by padding rather than by the fixed height the rest of the button scale uses. Unresolved.
- **`.btn-pill` contradicts the capsule rule.** It applies `rounded-full` to a *pressed* control, which the Capsule-Is-Read-Not-Pressed Rule exists to forbid. It is in the sheet; it should not be extended to new controls.
- **`font-mono` survives on figures.** 56 call sites use it, and roughly twenty are numeric displays rather than identifiers — the dispatch stopwatches in `dispatch/parts.jsx` and `DispatchDetailDrawer.jsx`, the "*n* selected" counters in `FiledReportsTable.jsx`, `SecurityReportsPage.jsx` and `AuditHistoryTable.jsx`, the WPDA score in `IncidentBreakdown.jsx`, the counts in `CategoryBreakdownPanel.jsx`, the toast and bell timestamps. The stylesheet's own typography comment still argues the broad mono-for-machine-data split and has not been narrowed to match. Drift, not the system.
- **Inline search shells have no visible focus.** Fifteen bare `<input>` elements carry `outline-none` inside a bordered wrapper, and only six files use `focus-within` at all, so most inline search fields show nothing when focused. A hole in the focus floor, not a style.
- **Inline search shells use the surface radius.** Several are `rounded-xl` (12px) though they are controls and belong at 8px.
- **The stylesheet's radius comment is stale.** The `RADIUS TIERS` block still lists three steps and labels two of them `rounded-xl  12px`, describing the state mid-move. The compiled CSS is the authority: `--radius-xl: .75rem`, `--radius-lg: .5rem`, `--radius-md: .375rem`.
- **`.field` keeps a translucent focus ring.** `outline-none` plus `focus:ring-2 focus:ring-brand-500/20` is the deliberate field treatment and it is legible, but it is the single survivor of the ring removal, so "focus is one solid outline" is true of controls and not of fields.
