import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:latlong2/latlong.dart';

/// The Monticello Villas premises polygon.
///
/// Reads `assets/geo/monticello_villas_boundary.geojson` — the SAME file the
/// React dashboards import through Vite's `@geo` alias (see
/// `web-portal/src/shared/lib/subdivisionBoundary.js`). One file, two
/// platforms: that is the only way the perimeter drawn on a resident's phone
/// and the perimeter drawn on the dispatcher's map are guaranteed to be
/// identical rather than two hand-copied lists that drift apart.
///
/// Re-tracing the boundary is therefore a single-file edit with no code change
/// on either platform.
class SubdivisionBoundary {
  SubdivisionBoundary._();

  static const String assetPath = 'assets/geo/monticello_villas_boundary.geojson';

  // ── Styling, mirroring BOUNDARY_STYLE in subdivisionBoundary.js ───────────
  /// Oxblood core stroke.
  static const Color stroke = Color(0xFF3C0008);

  /// Gold casing drawn beneath [stroke]. Oxblood is very dark, and on satellite
  /// imagery of vegetation or asphalt a single dark line vanishes; the casing
  /// gives it a bright halo so one colour scheme works on both basemaps.
  static const Color casing = Color(0xFFF5C451);

  static const double fillOpacity = 0.07;
  static const double coreWidth = 2.2;
  static const double casingWidth = 5.0;

  static List<LatLng>? _ring;

  /// Outer linear ring, first point repeated at the end.
  ///
  /// Empty until [load] has completed. Callers that run before then fall back
  /// to the bounding box (see [contains]), which still geofences — just more
  /// coarsely — rather than failing open and accepting any coordinate.
  static List<LatLng> get ring => _ring ?? const [];

  static bool get isLoaded => _ring != null && _ring!.length >= 4;

  /// Parses the canonical GeoJSON. Call once during app start-up, before any
  /// map screen can mount.
  static Future<void> load() async {
    try {
      final raw = await rootBundle.loadString(assetPath);
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final features = decoded['features'] as List<dynamic>;
      final geometry = (features.first as Map<String, dynamic>)['geometry']
          as Map<String, dynamic>;

      if (geometry['type'] != 'Polygon') {
        throw FormatException('Expected a Polygon, got ${geometry['type']}');
      }

      // GeoJSON positions are [longitude, latitude] — the opposite order to
      // LatLng's constructor. Getting this backwards silently places the
      // subdivision in the Indian Ocean, so it is worth being explicit.
      final outerRing = (geometry['coordinates'] as List<dynamic>).first as List<dynamic>;
      final points = outerRing.map((position) {
        final pair = position as List<dynamic>;
        return LatLng(
          (pair[1] as num).toDouble(), // latitude
          (pair[0] as num).toDouble(), // longitude
        );
      }).toList(growable: false);

      if (points.length < 4) {
        throw const FormatException('A polygon ring needs at least 4 positions');
      }

      _ring = points;
    } catch (error, stack) {
      // Never fatal: a missing or malformed asset must not stop a resident from
      // reporting an incident. [contains] falls back to the bounding box.
      _ring = null;
      if (kDebugMode) {
        debugPrint('SubdivisionBoundary: could not load $assetPath — $error');
        debugPrintStack(stackTrace: stack);
      }
    }
  }

  /// Point-in-polygon by ray casting (crossing number).
  ///
  /// Replaces the bounding-box containment test this used to be. The premises
  /// are not a rectangle — Angela Avenue cuts the northern edge on a diagonal —
  /// so their bounding box overshoots by ~13 ha into the fields and houses on
  /// the FAR side of the road. A bbox check called all of that "inside
  /// Monticello Villas", letting a resident pin an incident across the highway.
  ///
  /// Counts how many times a ray cast east from the point crosses an edge: odd
  /// means inside. The `(lat < y0) != (lat < y1)` form only counts edges that
  /// genuinely straddle the ray, avoiding a double count when the ray passes
  /// exactly through a vertex.
  static bool contains(LatLng point, {required bool Function(LatLng) fallback}) {
    final ringPoints = _ring;
    if (ringPoints == null || ringPoints.length < 4) return fallback(point);

    var inside = false;
    for (var i = 0, j = ringPoints.length - 1; i < ringPoints.length; j = i, i++) {
      final a = ringPoints[i];
      final b = ringPoints[j];
      final straddles = (point.latitude < a.latitude) != (point.latitude < b.latitude);
      if (!straddles) continue;

      final crossingLng = a.longitude +
          ((point.latitude - a.latitude) / (b.latitude - a.latitude)) *
              (b.longitude - a.longitude);
      if (point.longitude < crossingLng) inside = !inside;
    }
    return inside;
  }

  /// How far inside the perimeter a snapped point lands, in metres.
  ///
  /// A point EXACTLY on the edge is a coin toss for [contains] — floating
  /// point decides which side of the ring it falls — so a snap that stopped
  /// on the line could be judged outside and bounced again. A few metres in is
  /// below what a pin on a phone can resolve and well clear of rounding.
  static const double snapInsetMetres = 4;

  /// The point inside the premises nearest to [point]: [point] itself when it
  /// is already inside, otherwise the closest spot on the perimeter, pulled
  /// [snapInsetMetres] inward.
  ///
  /// Nearest on the ring, not the bounding-box clamp this replaced. A box
  /// clamp only moves along the axes, so a pin dropped across Angela Avenue
  /// — where the northern edge runs on a diagonal — was "clamped" to a corner
  /// of the box that is itself outside the polygon, and the snap failed.
  ///
  /// Distances are taken in a local flat projection (metres east/north of the
  /// point). Over a 1.4 km parcel the error of that against a true geodesic
  /// is millimetres; it is the nearest EDGE that matters, not its exact
  /// length.
  ///
  /// Returns null when the ring has not loaded, so callers keep their own
  /// fallback rather than snapping to nothing.
  static LatLng? nearestInside(LatLng point) {
    final ringPoints = _ring;
    if (ringPoints == null || ringPoints.length < 4) return null;
    if (contains(point, fallback: (_) => false)) return point;

    // Metres per degree at this latitude.
    const mPerDegLat = 111320.0;
    final mPerDegLng = mPerDegLat * math.cos(point.latitude * math.pi / 180);
    double x(LatLng p) => (p.longitude - point.longitude) * mPerDegLng;
    double y(LatLng p) => (p.latitude - point.latitude) * mPerDegLat;

    var bestDist = double.infinity;
    var bestX = 0.0, bestY = 0.0;
    // Inward direction at the best point: the left or right normal of its
    // edge, whichever faces the ring's interior (decided below).
    var edgeDx = 0.0, edgeDy = 0.0;
    for (var i = 0; i < ringPoints.length - 1; i++) {
      final ax = x(ringPoints[i]), ay = y(ringPoints[i]);
      final bx = x(ringPoints[i + 1]), by = y(ringPoints[i + 1]);
      final dx = bx - ax, dy = by - ay;
      final len2 = dx * dx + dy * dy;
      // The point is the origin, so the projection is of (-ax, -ay).
      final t = len2 == 0 ? 0.0 : ((-ax * dx - ay * dy) / len2).clamp(0.0, 1.0);
      final px = ax + t * dx, py = ay + t * dy;
      final d = px * px + py * py;
      if (d < bestDist) {
        bestDist = d;
        bestX = px;
        bestY = py;
        edgeDx = dx;
        edgeDy = dy;
      }
    }

    LatLng toLatLng(double ex, double ny) => LatLng(
          point.latitude + ny / mPerDegLat,
          point.longitude + ex / mPerDegLng,
        );

    // Step inward along the edge normal. Which normal is "inward" depends on
    // the ring's winding, so both are tried; at a convex vertex the nearest
    // point is the vertex itself and one of the two adjacent normals might
    // still miss, so the inset is retried a little deeper before giving up.
    final len = math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
    if (len > 0) {
      final nx = -edgeDy / len, ny = edgeDx / len;
      for (final depth in const [1.0, 2.0, 4.0]) {
        for (final sign in const [1.0, -1.0]) {
          final inset = snapInsetMetres * depth * sign;
          final candidate = toLatLng(bestX + nx * inset, bestY + ny * inset);
          if (contains(candidate, fallback: (_) => false)) return candidate;
        }
      }
    }

    // Degenerate geometry (a spike narrower than the inset): walk from the
    // edge point toward the ring's vertex average, which for this parcel is
    // well inside.
    final cx = ringPoints.map(x).reduce((a, b) => a + b) / ringPoints.length;
    final cy = ringPoints.map(y).reduce((a, b) => a + b) / ringPoints.length;
    for (final f in const [0.02, 0.05, 0.1, 0.25, 0.5, 1.0]) {
      final candidate =
          toLatLng(bestX + (cx - bestX) * f, bestY + (cy - bestY) * f);
      if (contains(candidate, fallback: (_) => false)) return candidate;
    }
    return null;
  }
}
