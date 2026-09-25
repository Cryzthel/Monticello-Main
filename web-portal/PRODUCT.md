# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **HOA administrators**, at a desk. They verify new residents, broadcast announcements, review incidents and the audit history, and provision and manage security accounts. They work in the Admin Portal.
- **Security officers**, at the guardhouse console and on patrol. They watch the live dispatch map, respond to SOS alerts, work incidents through their dispatch stages, file reports, and clock in and out of duty. They work in the Guardhouse (Security) Portal, sometimes from a phone.
- **Residents** use the separate Flutter mobile app to report incidents and send SOS alerts. That app is out of scope for this record except where its data and palette reach the web consoles.

## Product Purpose

Safety and community operations for one gated subdivision, Monticello Villas. Every resident report and SOS reaches the right officer fast, is worked to a documented close, and stays auditable.

## Positioning

One platform joins the resident's phone to the guardhouse. A report or SOS filed in the mobile app appears live on the officers' dispatch map. It is worked through enforced response stages, and every step is recorded for the HOA to review.

## Operating Context

- The guardhouse runs at least one console that stays open through a shift. Officers also use it on patrol from a phone browser.
- Administrators use the Admin Portal as a desk tool for review, verification, broadcasting and reporting.
- Both consoles are live views of Firestore data; nothing is refreshed by hand.

## Capabilities and Constraints

- Two web consoles in one monorepo (`apps/admin-portal`, `apps/security-portal`) sharing `packages/shared`: React 19, Vite, Tailwind CSS v4, Firebase JS SDK, Mapbox GL.
- Firebase is on the free Spark plan: Firestore rules deploy, Cloud Functions cannot redeploy until billing is enabled. Firestore rules are the authority for who may change what.
- Desktop-first, usable down to phone width. Light and dark themes are both supported.
- Real data only: no invented metrics, testimonials, or claims in either console.

## Brand Commitments

- The mobile app's palette (`lib/core/theme/app_theme.dart`, `AppColors`) is the brand authority. Its accent is emerald. When a brief and the mobile palette disagree, the mobile palette wins unless the user decides otherwise for a specific element.
- The consoles aim for a calm, conventional corporate-SaaS presentation rather than an expressive one (user brief, 2026-09-22).

## Evidence on Hand

- Live Firestore data: incidents, SOS alerts, residents, staff accounts, shifts and announcements.
- There are no testimonials, benchmarks, or marketing claims, and none may be fabricated.

## Product Principles

1. Speed to the right officer beats everything else on the Guardhouse side.
2. Every action that changes a report is recorded and attributable.
3. The two consoles describe the same facts the same way, so an administrator and an officer never disagree about what happened.
4. Nothing is shown that the data cannot support.

## Accessibility & Inclusion

WCAG 2.1 AA contrast is the working standard. The shared stylesheet measures text and control contrast in both themes. Reduced-motion preferences are honoured.
