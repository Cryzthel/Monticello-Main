---
version: 1
slug: "admin-portal-src-pages-dashboardpage-jsx-bd34d113"
primary_target: "web-portal/apps/admin-portal/src/pages/DashboardPage.jsx"
related_targets: ["web-portal/apps/security-portal/src/pages/DashboardPage.jsx","web-portal/packages/shared/src/styles/index.css","web-portal/packages/shared/src/layouts/DashboardLayout.jsx"]
---

# Console redesign: Admin and Guardhouse portals

Scope: every authenticated surface of both web consoles, restyled onto one shared system. Primary target is the Admin Overview; related targets are the shell, the shared stylesheet and each named page. Mode: Operate.

Audience and task: HOA administrators reviewing the subdivision at a desk; security officers working live calls at the guardhouse and on patrol. Success is reading a page's state in one glance and reaching its next action without hunting.

Must not change: behaviour, data, copy that states facts, the dispatch map's full-height layout, dark mode, keyboard access, reduced-motion handling.

User decisions (2026-09-22): buttons, inputs, search and segmented tracks are 8px rectangles, and capsules remain only for status, trend, count and filter pills. The primary CTA is near-black (slate-900 light, zinc-50 dark). Emerald remains the brand accent for active navigation, focus, success and charts.

## Direction contract

THESIS: A calm, layered corporate console, where quiet surfaces let the data and the one next action lead. It refuses the flat, grid-of-bordered-boxes admin look, in which every panel shouts at the same volume.

OWN-WORLD: Soft grey canvas (#F5F6F8; near-black in dark) under white working surfaces. Each surface has a 1px low-contrast hairline, a whisper of shadow, 16px outer and 12px nested corners, and 8px controls. There is one near-black primary button per view. Status appears as pastel capsules (50-step fill, 700-step ink). Emerald is reserved for navigation state and success. Text is Inter throughout, with tabular numerals for figures.

STORY: An administrator lands on the Overview and knows the period's incidents, open SOS alerts, resolution rate and response time before scrolling, then opens the newest incident. An officer sees the map, the active call and the one action that advances it.

FIRST VIEWPORT: The top bar holds the sidebar toggle, a full-width search field on the left, and on the right the near-black portal action, the theme toggle and the bell. Below it on the left sits "Welcome back, {first name}" in 24px bold with a slate-500 line under it; the timeframe control sits opposite. Next come four layered KPI cards: a white inner face with label and 30px figure, over a grey footer strip carrying the trend capsule. The analytics panel and the recent-incidents table follow.

FORM: Reference-pinned canon, a user-supplied corporate-SaaS dashboard held as the craft bar. The direction is user-pinned, so there is no concept-seed key (the roll was not run).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
