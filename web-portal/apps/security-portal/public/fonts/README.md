# Brand font — Groote

The "Monticello Villas" wordmark is set in **Groote** (Artiveko). It is
self-hosted rather than linked — there is no CDN behind it.

    groote-400.otf        the face
    groote-LICENSE.txt    its licence, kept beside it on purpose

The `@font-face` that consumes it is at the top of
`packages/shared/src/styles/index.css`.

## ⚠ This is the DEMO cut, and it is not licensed for production

Artiveko's demo licence grants **personal, testing and educational use only**.
It explicitly forbids commercial use, modification, and redistribution.

Serving this file from a public production origin is not covered. For the
thesis prototype it is fine; before this console goes live for a real
subdivision, buy the full cut — <https://artiveko.com/groote-modern-logo-font/>
— which also brings the complete character set and multilingual support.

## Why .otf and not .woff2

woff2 would be roughly half the bytes, and normally that is the right trade.
Not here: the licence forbids modifying the font, and re-compressing it into
another container invites exactly that argument. The whole face is 9,984
bytes, so the saving is about 4 KB on a single request — not worth a licence
question. Convert it when the full commercial cut lands.

## Weight: 400, and the markup matches

The demo ships one master, `usWeightClass 400`. The wordmark therefore sets
`font-normal`, not `font-semibold`: against a family with only a 400, asking
for 600 does not get a heavier cut, it gets the browser smearing this one's
stems to fake a weight that does not exist.

Regular is also what the artwork asks for — the Figma wordmark is set in
**Regular**. If you buy the full cut and want a heavier lockup, add a second
`@font-face` block for the real weight; do **not** widen `font-weight` on the
existing one, which re-licenses the same fake bold.

## Coverage: basic Latin only

92 glyphs — `A–Z a–z 0–9`. That covers "Monticello Villas" exactly, and
nothing else in the product is set in this face, which is the discipline that
keeps it true. Any other string routed through `--font-brand` will fall
through to the next family part-way along.

## Fallback chain

`--font-brand` is `'Groote', 'Affinik', 'Chillax', var(--font-sans)`. Affinik
was the previous face and has no file committed; Chillax comes from Fontshare
via a `<link>` in both `index.html` files. That `<link>` can go once you are
satisfied Groote is loading everywhere — it is a render-blocking stylesheet
plus a font download that nothing will use any more.
