# Monticello Villas — Web Portals

Two **independent** React + Vite applications in one workspace:

| App                                            | Package                       | Dev port | Roles                                              |
| ---------------------------------------------- | ----------------------------- | -------- | -------------------------------------------------- |
| **Admin Portal** — `apps/admin-portal`         | `@monticello/admin-portal`    | **3000** | `super_admin`, `hoa_admin`                         |
| **Guardhouse Portal** — `apps/security-portal` | `@monticello/security-portal` | **3001** | `super_admin`, `security_head`, `security_officer` |

They share presentation and data-access code through `packages/shared`, and
nothing else. Neither app can route to, link to, or hold a session belonging to
the other — see [Isolation](#how-the-two-portals-stay-isolated).

Backend is Firebase — Firestore, Storage, and `onCall` Cloud Functions in
[`../functions`](../functions).

## Layout

```
web-portal/
├── .env.example            template → copy to .env.local (BOTH apps read it)
├── package.json            workspace root; dependency set + orchestration
├── apps/
│   ├── admin-portal/
│   │   ├── index.html
│   │   ├── vite.config.js  port 3000, __PORTAL__ = 'admin'
│   │   └── src/
│   │       ├── app/        App, AppRoutes
│   │       ├── config/     THIS portal's role allowlist + route table
│   │       └── components/ hooks/ layouts/ lib/ pages/ styles/
│   └── security-portal/    same shape, port 3001, __PORTAL__ = 'security'
└── packages/shared/src/
    ├── auth/               AuthContext, RequireAuth, LoginForm, LoginLayout
    ├── components/ hooks/ layouts/ lib/ theme/
    ├── config/portal.js    reads the injected __PORTAL__
    └── styles/index.css    the design system
```

The rule the layout encodes: **a module lives in `packages/shared` only if both
apps use it.** Anything one portal alone touches belongs to that portal, so
adding a screen to one console cannot alter the other's bundle.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` **in this directory** and fill in the
Firebase and Mapbox values. One file serves both apps — each app's
`vite.config.js` points `envDir` here — because the two consoles use the same
Firebase project, and a per-app copy is a credential that gets rotated in one
place and forgotten in the other.

## Running

Each portal is its own process. Run them in two terminals; neither depends on
the other:

```bash
npm run dev:admin
```

```bash
npm run dev:security
```

| Portal     | Dev                     | Preview                 |
| ---------- | ----------------------- | ----------------------- |
| Admin      | `http://localhost:3000` | `http://localhost:4300` |
| Guardhouse | `http://localhost:3001` | `http://localhost:4301` |

`npm run dev` starts both. There is no combined single-origin mode and no
landing page: each app serves its own console at `/`, and signing out lands on
that app's own `/login`.

Ports are `strictPort`, so a busy port fails loudly instead of sliding to the
next free one. A guardhouse server that quietly landed on 3000 would be
indistinguishable from the admin server at exactly the moment you are testing
that the two are separate — and worse, would then *share* its origin.

### Builds

```bash
npm run build
```

```bash
npm run build:admin
```

```bash
npm run build:security
```

Output goes to `apps/<app>/dist` — two independent artifacts, deployable to
separate hosts on separate schedules.

## Routes

No `/admin` or `/security` prefix. The prefix existed to tell two portals apart
inside one bundle; they are no longer in one bundle, so the origin carries that
information and the path does not repeat it.

| Admin (`:3000`)      | Guardhouse (`:3001`) |
| -------------------- | -------------------- |
| `/login`             | `/login`             |
| `/dashboard`         | `/dashboard`         |
| `/heatmap`           | `/tickets`           |
| `/tickets`           | `/sos`               |
| `/sos`               | `/report`            |
| `/reports`           | `/history`           |
| `/residents`         | `/performance`       |
| `/security-accounts` | `/settings`          |
| `/metrics`           |                      |
| `/announcements`     |                      |
| `/history`           |                      |
| `/settings`          |                      |

Each app's table is declared once in its own `src/config/portal.js` and consumed
by both the router and the sidebar, so a path cannot drift between them.

An unmatched URL sends a **signed-in** operator to their dashboard, not to
`/login`. Answering a navigation miss with a sign-in form reads, to the person
looking at it, as having been signed out — which buries the actual bug under a
false report of a logout.

## How the two portals stay isolated

Four mechanisms, each covering a case the others do not.

### 1. Separate origins

An origin is scheme + host + **port**, so `localhost:3000` and `localhost:3001`
have entirely separate `localStorage`, `sessionStorage`, IndexedDB and cookie
jars. This is enforced by the browser, not by our code: no bug in this
repository can let one console read the other's session tokens.

### 2. Build-time portal identity

`packages/shared/src/config/portal.js` reads `__PORTAL__`, injected as a literal
by each app's `vite.config.js` `define` block. It is not an environment variable
and not derived from the URL.

Both of those were the old design, and both were wrong. Path-derived identity
made portal identity a property of the address bar — a document served by the
admin origin that happened to sit on `/security/...` resolved as the *security*
portal, which in turn chose the Firebase app name that owns the auth session.
Env-derived identity is ambient and overridable by a stray shell export or a
copied `.env`. Identity that something outside the app can flip is not an
identity.

The module **throws** if `__PORTAL__` is absent, so a misconfigured app fails at
import instead of silently falling back to a shared default — the fallback was
the collision.

### 3. Per-portal Firebase app name

Firebase Auth persists the signed-in user under

```
firebase:authUser:{apiKey}:{appName}
```

in IndexedDB — **one slot per app name per origin**. Both consoles previously
called `getAuth()` on the *default* app and shared one slot: signing into the
guardhouse overwrote the admin session, and Firebase's cross-tab listener pushed
that eviction to every open tab, bouncing the admin to login.

`packages/shared/src/lib/firebase.js` names the app after the portal:

| Portal     | App name   | Auth key                              |
| ---------- | ---------- | ------------------------------------- |
| Admin      | `admin`    | `firebase:authUser:{apiKey}:admin`    |
| Guardhouse | `security` | `firebase:authUser:{apiKey}:security` |

Separate ports already separate these. The app name is defence in depth for the
day someone puts both behind one hostname — a reverse proxy, a staging box, a
path-based deployment — where the port no longer separates them and this is the
only thing left that does.

Firestore, Storage and Functions handles come from that **same** app on purpose:
each attaches the ID token of the auth instance belonging to its app, so mixing
them would issue unauthenticated requests and every `firestore.rules` check
would deny.

### 4. Session rejection at the auth boundary

Each app hands `AuthProvider` **only its own** role allowlist, from its own
`src/config/portal.js`. A credential resolving to any other role is signed
straight back out before the app ever reports itself authenticated.

This replaced a route guard, and the difference matters. Previously any approved
staff account became `isAuthenticated` in either console, and the guard was the
only thing between a guard's credentials and the admin dashboard. A guard who
typed their password into the admin login got a live Firebase session persisted
in the **admin** origin's IndexedDB — refresh tokens and all — and saw only a red
error message. The tokens outlived the error.

Rejecting at the provider makes it structural: the admin app cannot hold a
guardhouse session, so no route it grows later can accidentally honour one.

The client-side allowlist is a *convenience*, never the enforcement.
`../firestore.rules` and `../functions/index.js#requireStaff` are the
enforcement. Keep the three in sync — they are one policy written three times
because it runs in three places.

### Namespaced browser storage

`portalKey(name)` produces `mv:{portal}:{name}` — `mv:admin:sidebar-collapsed`,
`mv:security:guard-prefs`. On separate origins this is belt-and-braces, and it
stays because the cost is one string concat and the failure it prevents (two
consoles overwriting each other's notification read-cursor after someone
co-hosts them) is invisible until it is a support ticket.

**The theme key is deliberately un-namespaced.** It is a device preference
carrying no session or role identity. Namespacing it would also force the
pre-paint script in `index.html` to resolve the portal before it can read the
key, buying a flash of the wrong theme to isolate a value with nothing to
isolate.

## Styling

The design system is one file, `packages/shared/src/styles/index.css`
(Tailwind v4 — there is no `tailwind.config.js`; the `@theme` block *is* the
config, and a `tailwind.config.js` added here would be silently ignored).

It declares `@import "tailwindcss" source(none)`, which turns **off** Tailwind's
automatic content scanning. Auto-detection scans outward from the directory
holding the CSS file, which would scan `packages/shared` and miss both apps —
every app-specific class silently absent from the build, no error, just an
unstyled page. With detection off every source is explicit: the shared sheet
names its own tree, and each app names its own `src/` in
`apps/<app>/src/styles/index.css`.

That is why each app has a two-line entry stylesheet rather than importing the
shared one directly.

### The one rule for adding a shadow

The visual language is **modern flat / corporate SaaS**: a white surface on a
slate-50 canvas, bounded by a 1px `border-slate-200` line, at a 6px radius.
There is no elevation modelling — `--shadow-panel` resolves to `none`, and the
only surfaces that still cast are the ones genuinely stacked above the page
(dropdowns, popovers, modals). A shadow on an in-page card is a bug.

Shadows are still tokenised, and one rule about them matters more than the rest:

> A `--shadow-*` entry inside `@theme` must be `var(--elev-something)`, never a
> literal value.

Tailwind resolves `@theme` values at **build** time, so a literal is baked into
the generated utility and the `.dark` override can never reach it — `shadow-x`
then paints the light-mode shadow in dark mode, silently. Pointing at a plain
custom property defers resolution to paint time, which keeps the utility and
the `box-shadow: var(--shadow-x)` call sites on the same value. The real values
live in the `:root` block above `@theme` and are reassigned in `.dark`.

This was a real bug once: every dropdown, row menu, toast and map control used
`shadow-overlay` and rendered the light shadow on a near-black canvas.

### Capsules and rectangles

Two shapes, two jobs. **Surfaces and text fields** (cards, dialogs, inputs,
dropdown fields) are `rounded-lg`. **Anything you press or read as a token** is
a capsule (`rounded-full`) with `px-4 py-1.5` at its standard size:

| Use | Build it with |
| --- | --- |
| Pick exactly one (timeframes, view switchers, tabs) | `@shared/components/SegmentedControl` — never hand-written `.segmented` markup |
| Action button | `.btn` + a size (`.btn-compact`, `.btn-form`, `.btn-sm`, `.btn-md`) + a tone |
| Icon-only button | `.icon-btn` + `.icon-btn-sm` / `.icon-btn-md` |
| Independent filter toggles | `.chip` + `.chip-idle` / `.chip-active` |
| Status or category label | `@shared/components/StatusBadge` |
| A tally inside a segment or chip | `.count-pill` |
| On/off | `@shared/components/Switch` |

`SegmentedControl` animates its selection by clipping a second, brand-coloured
copy of the labels to the selected segment, so the pill and the label colour
move together. If a group can overflow, put `overflow-x-auto` on a **wrapper**,
not on the control.

## Notification preferences

Admin Portal › Settings is one card with two switches, saved together to
`system_settings/operations` (schema and defaults:
`packages/shared/src/lib/systemSettingsStore.js`):

| Switch | Field | Read by |
| --- | --- | --- |
| Push notifications | `push.enabled` | Cloud Functions, before a resident push (report updates, "help is on the way"). The SOS push to on-duty officers ignores it — it is the alarm itself. |
| Emergency sound alerts | `sos.sirenEnabled` | Every guardhouse console's SOS siren, live. The banner and map marker show regardless. |

Any approved staff account can read the document; any administrator can write
it, and the rules accept only those two booleans plus the save stamp. **Until
someone saves, both are on**, which is how the consoles behaved before the
switches existed. Saves need the rules deployed; the push switch also needs the
functions redeployed, which the Spark plan cannot do (see
[Deploying](#deploying-on-the-spark-plan) below).

## Dispatch workflow

The Guardhouse's Live Dispatch map drives every report through five stages, in
order, with no skipping:

```
DISPATCHED ──► RESPONDING ──► ON-SITE ──► INVESTIGATING ──► RESOLVED
```

| Stage | Who | What it writes |
| --- | --- | --- |
| Dispatched | Any officer (the dispatcher), picking an on-duty unit | `assignedGuard*`, `dispatchedAt`, `dispatchedBy*`. A reassignment is the same edge again. |
| Responding | The assigned officer (or a supervisor), **Acknowledge & respond** | `respondingAt`. That officer's device switches to high-precision GPS, and the resident is pushed "Guard … is en route". |
| On-site | Same, **I have arrived** | `onSceneAt`, `arrival`. Passes only within 30 m of the pin on a fix accurate to ±50 m. Otherwise it needs a written override reason. The rules re-measure the claim themselves. |
| Investigating | Same, **Begin investigation** | `investigatingAt`, then quick tags, scene photos and a one-time `escalation`. |
| Resolved | Same, **Resolve incident** | `resolution: { outcome, notes, photoUrls }` (all required, at least one photo), `resolvedAt/By`, `ratingRequestedAt` (the resident app asks for 1–5 stars). |

**The stage lives in `dispatchStage`, and `status` keeps its old wire
values**: dispatched/responding write `dispatched`, on-site/investigating write
`in_progress`, resolved writes `resolved`. The resident app reads an unknown
status as Pending, so new wire values would have told a resident with a guard
on the way that nobody had looked yet. Reports from before the field read their
stage from `status` (`deriveDispatchStage`, mirrored by `currentStage()` in the
rules).

**`firestore.rules` is the authority.** Each stage is one batched write
(`apps/security-portal/src/lib/dispatchWorkflow.js`, which stands in for the
brief's `POST /incidents/*` endpoints). The rules accept it only if:
- it is the next edge from the stored stage
- it is made by someone allowed to make it
- it carries the fields that edge needs
- an audit entry is written in the same batch

Residents and admins cannot write any workflow field, and residents cannot file
a report that starts past Pending.

**Forensic log.** Every workflow write creates `incidents/{id}/status_log/{entry}`
in the same batch: `userId`, the device's `geolocation`, `batteryLevel` and
`deviceTelemetry`, the device clock (`clientAt`) beside the server time (`at`),
and whether it was queued offline. Entries are append-only for everyone.

**Units.** Each officer's console publishes `guard_telemetry/{uid}` while they
are clocked in (`useGuardTelemetry`):
- position and battery every 30 s–2 min when idle, unless the officer turns
  idle sharing off in Settings
- every 4–20 s once they acknowledge a call
- nothing off duty

The map draws units green (available), flashing orange (responding) and blue
(on scene). The route runs from the unit's live position, emerald once
acknowledged and blue as a preview, with direction chevrons, and re-plots as
the unit moves.

**Offline.** The Guardhouse keeps Firestore's cache in IndexedDB, and stage
writes are batches, not transactions. A press with no signal therefore applies
on screen at once and syncs when the connection returns. Photo uploads cannot
queue, so Resolve needs a connection for its evidence.

**Dead-man switch.** `DispatchWatchdog`, mounted above the routes, alerts the
booked officer the moment they are dispatched, and every console if the call
is still Dispatched 90 s later. It also raises escalations. It is client-side
because scheduled functions need the Blaze plan, so it only fires while a
Guardhouse console is open.

## Deploying on the Spark plan

The project is on Firebase's free Spark plan. Rules deploy; Cloud Functions do
not (they need Blaze billing), and a combined deploy aborts before releasing
the rules. Deploy the rules on their own:

```bash
firebase deploy --only firestore:rules
```

That is all the dispatch workflow needs to run. Two parts wait on functions:
- the stage-aware resident pushes ("Guard … is en route", the rating prompt
  push)
- the push-notifications switch

Until then, the deployed function sends its older sentence for the matching
status. The resident app's rating prompt reads `ratingRequestedAt` from the
report itself, so it works without a push, once the mobile app is rebuilt.

## Optional: custom local hostnames

Distinct ports already give distinct origins, so this is cosmetic unless you
want hostnames that mirror production. Add to the hosts file —
`C:\Windows\System32\drivers\etc\hosts` on Windows (edit as Administrator),
`/etc/hosts` on macOS/Linux (needs `sudo`):

```
127.0.0.1   admin.local
127.0.0.1   security.local
```

Then browse `http://admin.local:3000` and `http://security.local:3001`. Both are
registered in the respective `vite.config.js` under `server.allowedHosts` —
without that, Vite's DNS-rebinding protection rejects the unrecognised `Host`
header and you get a blank page rather than an obvious error.

`.local` is reserved for mDNS/Bonjour, which can make resolution slow or flaky
on some macOS and Linux setups. `admin.localhost` / `security.localhost` resolve
to loopback without a hosts entry in Chrome and Firefox and are the safer choice
if you hit that.

## Cookies and CORS

Neither needs configuration here, and it is worth recording why so the question
does not get re-litigated:

- **No cookies are involved in auth.** The Firebase JS SDK holds an ID token in
  IndexedDB and attaches it as an `Authorization: Bearer` header per request.
  There is no `admin_sid`/`security_sid` to name or path-scope; session
  separation is the origin and app-name scoping described above. If a
  cookie-based session is ever added, note that **Firebase Hosting strips every
  cookie except one named `__session`** before it reaches a function — that
  single reserved name, not a per-portal name, becomes the binding constraint.
- **No CORS allowlist to maintain.** Every function in `../functions/index.js`
  is `onCall`, and callables handle their own CORS. Firestore and Storage are
  reached through Google-hosted endpoints that already permit browser origins.
  Adding dev ports or custom hostnames requires no backend change.

Two things *are* origin-sensitive if you extend the setup:

- **Firebase Auth authorized domains** (Console → Authentication → Settings)
  gate OAuth popup/redirect and email-link sign-in. Email/password — all this
  app uses today — is unaffected, so custom hostnames work without touching it.
  Adding Google sign-in would change that.
- **Mapbox token URL restrictions**, if the token is scoped, must list any new
  origin.
