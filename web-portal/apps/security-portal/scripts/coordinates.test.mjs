/**
 * Where a report or SOS is drawn on the dispatch map.
 *
 *   node scripts/coordinates.test.mjs      (from apps/security-portal)
 *
 * `readLatLng` (packages/shared/src/lib/coordinates.js) is the one reader both
 * mappers use. The contract it protects: the coordinate the resident's pin
 * committed is the coordinate drawn — unrounded, unswapped — and a value that
 * cannot be a real position reads as NO position rather than as a pin in the
 * wrong place.
 */
import assert from 'assert'
import { readLatLng } from '../../../packages/shared/src/lib/coordinates.js'

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

const PIN = { lat: 10.765195512345, lng: 122.516661098765 }
const NONE = { lat: undefined, lng: undefined }

check('the mobile shape is read exactly, with every digit', () => {
  assert.deepStrictEqual(readLatLng({ location: { ...PIN } }), PIN)
})

check('a GeoPoint-like location reads by its getters', () => {
  const geo = { get latitude() { return PIN.lat }, get longitude() { return PIN.lng } }
  assert.deepStrictEqual(readLatLng({ location: geo }), PIN)
})

check("the mobile model's fallbacks: location {latitude, longitude} and top-level fields", () => {
  assert.deepStrictEqual(readLatLng({ location: { latitude: PIN.lat, longitude: PIN.lng } }), PIN)
  assert.deepStrictEqual(readLatLng({ latitude: PIN.lat, longitude: PIN.lng }), PIN)
})

check('numeric strings parse to the same numbers', () => {
  assert.deepStrictEqual(readLatLng({ location: { lat: String(PIN.lat), lng: String(PIN.lng) } }), PIN)
})

check('a text location label is not mistaken for coordinates', () => {
  assert.deepStrictEqual(readLatLng({ location: 'Phase 1 • Block 3 • Lot 12' }), NONE)
})

check('(0, 0), NaN, blanks and out-of-range values read as no position', () => {
  assert.deepStrictEqual(readLatLng({ location: { lat: 0, lng: 0 } }), NONE)
  assert.deepStrictEqual(readLatLng({ location: { lat: NaN, lng: 122.5 } }), NONE)
  assert.deepStrictEqual(readLatLng({ location: { lat: '', lng: '' } }), NONE)
  // Swapped lat/lng puts 122 in the latitude slot: impossible, so refused.
  assert.deepStrictEqual(readLatLng({ location: { lat: PIN.lng, lng: PIN.lat } }), NONE)
  assert.deepStrictEqual(readLatLng({}), NONE)
  assert.deepStrictEqual(readLatLng(null), NONE)
})

check('a broken nested location falls through to valid top-level fields', () => {
  assert.deepStrictEqual(readLatLng({ location: { lat: 0, lng: 0 }, latitude: PIN.lat, longitude: PIN.lng }), PIN)
})

console.log(`\n${passed} passed, ${process.exitCode ? 'failures above' : '0 failed'}`)
