// Shadows any postcss.config.js found in a parent directory (e.g. a home-dir
// Tailwind v3 project) — PostCSS's config search walks upward and would
// otherwise pick that one up instead. The @tailwindcss/vite plugin handles
// all Tailwind v4 processing directly, so no plugins are needed here.
export default {}
