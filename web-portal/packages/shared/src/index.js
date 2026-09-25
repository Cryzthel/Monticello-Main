/**
 * Marker entry for the @monticello/shared workspace package.
 *
 * Application code does NOT import from here. It imports through the `@shared`
 * Vite alias (`@shared/lib/firebase`, `@shared/auth/AuthContext`, …), which
 * both apps declare in their own vite.config.js.
 *
 * Why an alias rather than the package's own subpath exports: Node's `exports`
 * map requires the file extension in every specifier, which would mean writing
 * `@monticello/shared/lib/firebase.js` at ~200 call sites. The alias resolves
 * extensionlessly the way the rest of the codebase already does, and Vite
 * applies it to CSS `@import` too — which is what lets each app's stylesheet
 * pull in the shared design system by name.
 *
 * The package still exists as a real workspace member so `npm install` links
 * it, dependency tooling can see it, and the boundary is a package boundary
 * rather than a folder convention.
 */
export {}
