/**
 * The one reader for a document's map position, for every report and SOS the
 * consoles plot.
 *
 * The mobile app writes `location: { lat, lng }` as doubles, straight from the
 * centre of its map picker (incident_map_picker.dart: the needle's foot is the
 * camera centre), and the consoles draw `[lng, lat]` unrounded — so a pin lands
 * exactly where the resident put it. What this guards is the shapes around
 * that contract, each of which used to drop or misplace a pin:
 *
 *   • `location: { latitude, longitude }`, a Firestore GeoPoint, or top-level
 *     `latitude` / `longitude` — the mobile model's own fallbacks
 *     (Incident.fromMap), which the web did not read, so those reports had no
 *     pin at all;
 *   • numeric strings, from hand-edited or imported documents;
 *   • (0, 0) and out-of-range values — a failed fix, or lat and lng swapped —
 *     which plotted "Null Island" in the Gulf of Guinea or off-continent. They
 *     read as no position, which the maps already handle honestly.
 *
 * Returns `{ lat, lng }` as finite numbers, or `{ lat: undefined, lng:
 * undefined }` when the document carries no usable position.
 */
const NONE = Object.freeze({ lat: undefined, lng: undefined })

function num(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return NaN
}

function pair(lat, lng) {
  const a = num(lat)
  const b = num(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null
  if (a === 0 && b === 0) return null
  return { lat: a, lng: b }
}

export function readLatLng(d) {
  const loc = d?.location
  return (
    (loc && typeof loc === 'object'
      ? pair(loc.lat ?? loc.latitude ?? loc._lat, loc.lng ?? loc.longitude ?? loc._long)
      : null) ??
    pair(d?.latitude, d?.longitude) ??
    pair(d?.lat, d?.lng) ??
    NONE
  )
}
