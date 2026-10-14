/**
 * What the console accepts as knowing where somebody is.
 *
 *   node scripts/geolocation.test.mjs      (from apps/security-portal)
 *
 * ── WHY THIS ONE MATTERS OUT OF PROPORTION TO ITS SIZE ─────────────────────
 * `isUsableFix` is the only thing standing between a browser's guess and a dot
 * on the dispatch map. Downstream, a 5 km fix and a 10 m fix are both two
 * numbers: once the accuracy radius is dropped, nothing can tell a measured
 * position from an inferred one, and the map draws both as the same confident
 * dot. Every surface that reports where an officer is — the units layer, the
 * route origin, the navigation camera — is on the far side of this check.
 *
 * The bug it was written for is a laptop placing an officer at their ISP's
 * exchange while their phone placed them correctly, with both devices
 * reporting success. The fixtures below are the real accuracy radii the
 * providers return, because the whole design rests on the claim that there is
 * a wide gap between them.
 */

import assert from 'assert'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

// `pathToFileURL`, like the other tests here: this checkout's path contains an
// apostrophe, and a bare specifier for a workspace package does not resolve
// under bare node without the package exports map.
const here = path.dirname(fileURLToPath(import.meta.url))
const lib = await import(
  pathToFileURL(
    path.join(here, '..', '..', '..', 'packages', 'shared', 'src', 'lib', 'geolocation.js'),
  ).href
)
const { GPS_REJECT_ACCURACY_M, isUsableFix } = lib

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

/** Accuracy radii in metres, as each provider actually reports them. */
const PROVIDERS = {
  // Kept.
  'phone GPS outdoors': 5,
  'phone GPS, thin cover': 20,
  'laptop Wi-Fi triangulation': 40,
  'phone GPS indoors': 65,
  'phone, dense tree cover': 180,
  'cell tower in a stairwell': 900,
  // Rejected.
  'cell tower, rural': 3_000,
  'laptop IP geolocation': 12_000,
  'IP behind a VPN': 80_000,
}

check('every real positioning method is kept', () => {
  for (const [name, accuracy] of Object.entries(PROVIDERS)) {
    if (accuracy > GPS_REJECT_ACCURACY_M) continue
    assert.ok(isUsableFix({ accuracy }), `${name} (±${accuracy} m) was rejected`)
  }
})

check('every inferred position is rejected', () => {
  for (const [name, accuracy] of Object.entries(PROVIDERS)) {
    if (accuracy <= GPS_REJECT_ACCURACY_M) continue
    assert.ok(!isUsableFix({ accuracy }), `${name} (±${accuracy} m) was accepted`)
  }
})

check('the threshold sits in the GAP, not inside either cluster', () => {
  const kept = Object.values(PROVIDERS).filter((a) => a <= GPS_REJECT_ACCURACY_M)
  const rejected = Object.values(PROVIDERS).filter((a) => a > GPS_REJECT_ACCURACY_M)
  const worstKept = Math.max(...kept)
  const bestRejected = Math.min(...rejected)
  // The design claim: the two kinds of answer are far enough apart that the
  // exact line does not have to be right. If this ever fails, the threshold is
  // being asked to make a judgement call it cannot make, and the decision
  // belongs somewhere that has more to go on than a radius.
  assert.ok(
    bestRejected >= worstKept * 3,
    `only ${worstKept} m to ${bestRejected} m between the clusters — too tight for a single threshold`,
  )
})

// ── THE BOUNDARY ───────────────────────────────────────────────────────────

check('the threshold itself is inclusive', () => {
  assert.ok(isUsableFix({ accuracy: GPS_REJECT_ACCURACY_M }))
  assert.ok(!isUsableFix({ accuracy: GPS_REJECT_ACCURACY_M + 1 }))
})

// ── WHAT A MISSING OR BROKEN RADIUS MEANS ──────────────────────────────────

check('a provider that reports no accuracy is trusted, deliberately', () => {
  // `accuracy` is optional in the spec. Rejecting every fix from a provider
  // that omits it would choose NO position over an unlabelled one, which is
  // the opposite of the trade this check exists to make.
  assert.ok(isUsableFix({}))
  assert.ok(isUsableFix({ accuracy: null }))
  assert.ok(isUsableFix({ accuracy: undefined }))
  assert.ok(isUsableFix({ accuracy: NaN }))
  assert.ok(isUsableFix({ accuracy: Infinity }), 'Infinity is not finite, so it is not a claim')
})

check('no coords at all is not a crash', () => {
  assert.ok(isUsableFix(null))
  assert.ok(isUsableFix(undefined))
})

check('a nonsense negative radius is not treated as precise-and-rejected', () => {
  // Meaningless, but it is a claim of extreme precision rather than of
  // ignorance, so it passes rather than being dropped.
  assert.ok(isUsableFix({ accuracy: -1 }))
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
