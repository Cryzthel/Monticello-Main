/**
 * A URL that came from a document a resident can write, made safe to put in
 * an `href` (security audit, 2026-10-20).
 *
 * Evidence and ID-document URLs are stored on `incidents` and `residents`
 * documents that the resident themself writes. A value of `javascript:…` in
 * an Admin link would run in the portal's origin, with the admin's session —
 * a stored XSS that becomes an account takeover. React 19 refuses
 * `javascript:` hrefs on its own; this is the explicit allowlist that does not
 * depend on that: only http(s) passes, anything else returns null so the
 * caller renders no link at all.
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
