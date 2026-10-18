import 'package:latlong2/latlong.dart';

import 'package:monticello_villas_app/core/config/subdivision_boundary.dart';

class MapConstants {
  MapConstants._();

  // ─────────────────────────────────────────────────────────────────────────
  // Mapbox credentials & styles
  // ─────────────────────────────────────────────────────────────────────────

  /// Public (`pk.*`) Mapbox access token. Public tokens are designed to ship in
  /// client apps; for production, lock it to your bundle IDs / URLs in the
  /// Mapbox account dashboard rather than treating it as a secret.
  static const String mapboxAccessToken =
      String.fromEnvironment('MAPBOX_ACCESS_TOKEN');

  /// True once a real Mapbox token is present (lets the app fall back to free
  /// basemaps in dev if the token is ever blanked out).
  static bool get hasMapboxToken =>
      mapboxAccessToken.startsWith('pk.') &&
      mapboxAccessToken != 'YOUR_MAPBOX_ACCESS_TOKEN';

  // Mapbox style IDs — the same identifiers Mapbox's native SDKs address as
  // `mapbox://styles/<id>` (see [mapboxStyleUri]); `flutter_map` instead
  // fetches them as pre-rendered raster tiles via the Static Tiles API
  // ([mapboxTiles]), which needs no native Mapbox SDK/downloads token and
  // still renders the exact same vector style server-side.
  static const String styleStreet = 'mapbox/streets-v12';
  static const String styleSatellite = 'mapbox/satellite-streets-v12';
  static const String styleHighContrast = 'mapbox/dark-v11'; // high contrast

  /// The style URI a native Mapbox SDK (`mapbox_maps_flutter`, GL-JS, etc.)
  /// would load directly — kept for reference/documentation and for when
  /// this app migrates off raster tiles onto the native SDK.
  static String mapboxStyleUri(String styleId) => 'mapbox://styles/$styleId';

  /// Builds a Mapbox raster-tiles URL for a given style id (512px @2x for crisp
  /// labels on hi-dpi screens).
  static String mapboxTiles(String styleId) =>
      'https://api.mapbox.com/styles/v1/$styleId/tiles/512/{z}/{x}/{y}@2x'
      '?access_token=$mapboxAccessToken';

  // Free fallbacks used only when no Mapbox token is configured.
  static const String _fallbackStreet =
      'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png';
  static const String _fallbackSatellite =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  static const String _fallbackDark =
      'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

  /// Active street/clean basemap (Mapbox when available, Carto otherwise).
  static String get tileUrl =>
      hasMapboxToken ? mapboxTiles(styleStreet) : _fallbackStreet;

  /// Satellite imagery basemap.
  static String get satelliteTileUrl =>
      hasMapboxToken ? mapboxTiles(styleSatellite) : _fallbackSatellite;

  /// High-contrast (dark) basemap used by the accessibility toggle.
  static String get darkTileUrl =>
      hasMapboxToken ? mapboxTiles(styleHighContrast) : _fallbackDark;

  /// Attribution string required by the Mapbox & OpenStreetMap terms of use.
  static const String mapboxAttribution = '© Mapbox  © OpenStreetMap';

  // ── Monticello Villas, Brgy. Balabag, Pavia, 5001 Iloilo ──
  // Real-world coordinates sourced from OpenStreetMap for the Monticello Villas
  // subdivision (replaces the earlier placeholder location near Mandurriao).
  static const LatLng subdivisionCenter = LatLng(10.7646606, 122.5160917);

  // Axis-aligned extent of the premises polygon.
  //
  // These stay as the FALLBACK extent only. Anything framing a camera should
  // read [premisesSouthWest] / [premisesNorthEast], which derive the same box
  // from the boundary polygon itself — a hand-maintained bounding box is
  // exactly the geometry that silently disagrees with the shape it describes
  // once someone re-traces the perimeter.
  //
  // These two are the one copy of the extent that CANNOT be derived: they are
  // what [containsInSubdivision] and [clampToSubdivision] fall back to before
  // the GeoJSON asset has finished loading. Re-trace the perimeter and they
  // must be refreshed by hand — the geojson's `howToReplace` note says so too.
  static const LatLng subdivisionSouthWest = LatLng(10.760150, 122.513400);
  static const LatLng subdivisionNorthEast = LatLng(10.770241, 122.519922);

  static const double defaultZoom = 16.0;
  static const double minZoom = 14.5;
  static const double maxZoom = 19;

  /// The phases that actually exist at Monticello Villas.
  ///
  /// There is no Phase 4 — the numbering skips it on the ground. Mirrors
  /// `SUBDIVISION_PHASES` in `web-portal/src/shared/lib/subdivisionBoundary.js`,
  /// which is the canonical list the dispatcher's phase dropdowns are built
  /// from. A legacy record still carrying "4" is not erased anywhere; it simply
  /// has no phase of its own to be offered as a destination.
  static const List<String> subdivisionPhases = ['1', '2', '3', '5'];

  /// What the premises polygon actually encloses, spelled out for the map's
  /// framing chip. The boundary is one ring around the whole village, so a
  /// label naming a single phase misdescribes what is on screen.
  static const String premisesLabel = 'Monticello Villas · Phases 1–3, 5';

  // ── Resident property focus ──
  // Phase 1 Monticello Villas (the pinned location in the reference).
  static const String propertyAddress =
      'Phase 1, Monticello Villas, Brgy. Balabag, Pavia, 5001 Iloilo';
  static const String propertyShortLabel = 'Phase 1 · Monticello Villas';

  /// Default map focus — the centre of the subdivision. Sits inside the
  /// geofence so it survives the recentre/clamp logic.
  static const LatLng propertyPlotCenter = LatLng(10.7646606, 122.5160917);

  /// Zoom used to frame the village on open / recentre.
  static const double plotZoom = 16.0;

  /// A small rectangular footprint drawn as a distinct overlay to highlight the
  /// pinned area within the village (~44 m square around the focus point).
  static final List<LatLng> propertyPlotBoundary = [
    const LatLng(10.76486, 122.51589),
    const LatLng(10.76486, 122.51629),
    const LatLng(10.76446, 122.51629),
    const LatLng(10.76446, 122.51589),
  ];

  /// The real premises outline, loaded from the canonical GeoJSON shared with
  /// the web dashboards (see [SubdivisionBoundary]).
  ///
  /// The perimeter encloses the whole village PREMISES — the built phases plus
  /// the undeveloped land south and west of them — bounded by Angela Avenue to
  /// the north. That is deliberately wider than the built-up area: 66.9 ha
  /// against 18.2 ha of houses. It means the geofence also covers ground a
  /// resident can stand on that has no roof on it yet.
  static List<LatLng> get subdivisionBoundary => SubdivisionBoundary.isLoaded
      ? SubdivisionBoundary.ring
      : _bboxRing;

  /// Rectangular fallback, used only if the GeoJSON asset fails to load. Still
  /// geofences — just coarsely — rather than failing open.
  ///
  /// Derived from the two extent constants rather than repeating their numbers,
  /// so a re-traced perimeter cannot leave this ring describing the old one.
  static final List<LatLng> _bboxRing = [
    LatLng(subdivisionNorthEast.latitude, subdivisionSouthWest.longitude),
    subdivisionNorthEast,
    LatLng(subdivisionSouthWest.latitude, subdivisionNorthEast.longitude),
    subdivisionSouthWest,
    LatLng(subdivisionNorthEast.latitude, subdivisionSouthWest.longitude),
  ];

  // ── Premises framing ──────────────────────────────────────────────────────
  // The mobile mirror of `boundaryBounds()` / `boundaryMaxBounds()` in
  // web-portal/src/shared/lib/subdivisionBoundary.js. Both platforms compute
  // their camera limits from the same ring, so the area a resident can pan
  // over on a phone is the area a dispatcher can pan over on the wall map.

  /// Axis-aligned extent of [subdivisionBoundary], as (south, west, north,
  /// east). Falls back to the OSM bounding box before the asset has loaded.
  static ({double south, double west, double north, double east}) get _extent {
    final ring = subdivisionBoundary;
    if (ring.length < 4) {
      return (
        south: subdivisionSouthWest.latitude,
        west: subdivisionSouthWest.longitude,
        north: subdivisionNorthEast.latitude,
        east: subdivisionNorthEast.longitude,
      );
    }

    var south = ring.first.latitude;
    var north = ring.first.latitude;
    var west = ring.first.longitude;
    var east = ring.first.longitude;
    for (final p in ring) {
      if (p.latitude < south) south = p.latitude;
      if (p.latitude > north) north = p.latitude;
      if (p.longitude < west) west = p.longitude;
      if (p.longitude > east) east = p.longitude;
    }
    return (south: south, west: west, north: north, east: east);
  }

  /// Camera-limit padding, in degrees (~130 m). Matches `boundaryMaxBounds`'
  /// default on the web side.
  ///
  /// Without it the perimeter line can never leave the viewport edge, because
  /// a Mapbox camera bound constrains the camera CENTRE: a resident inspecting
  /// a lot that sits on the boundary itself could not centre it.
  static const double premisesFramePadding = 0.0012;

  /// South-west corner of the camera limit for the premises.
  static LatLng get premisesSouthWest => LatLng(
        _extent.south - premisesFramePadding,
        _extent.west - premisesFramePadding,
      );

  /// North-east corner of the camera limit for the premises.
  static LatLng get premisesNorthEast => LatLng(
        _extent.north + premisesFramePadding,
        _extent.east + premisesFramePadding,
      );

  /// Centre of the premises extent — the camera target that frames the whole
  /// village rather than one phase of it.
  static LatLng get premisesCenter => LatLng(
        (_extent.south + _extent.north) / 2,
        (_extent.west + _extent.east) / 2,
      );

  /// Floor for a premises-scoped camera when the fitted zoom cannot be
  /// computed (the map is gone, or the platform call fails).
  ///
  /// The premises run ~1109 m north-south (1374 m once padded), so a card
  /// 190–320 px tall frames the padded box at roughly zoom 14.4–15.1. 14.7 sits
  /// inside that band: close enough that a fallback still reads as "the
  /// subdivision", tight enough that it can never read as "the municipality".
  /// The measured value replaces it as soon as the map can report its own size.
  ///
  /// Was 15.0 back when the ring covered only the 928 m built extent. Left at
  /// 15.0 the fallback frame would now clip the premises on any card under
  /// ~300 px tall.
  static const double premisesMinZoom = 14.7;

  /// Ceiling on a *fitted* frame zoom.
  ///
  /// A platform call that fails quietly returns an unusable number rather than
  /// throwing, and a fit answer above this for a box ~1.4 km across is not
  /// credible at any card size this app renders. Past it the documented floor
  /// is the better answer — a slightly loose frame beats a camera pinned at
  /// street level with no way to pull back.
  static const double premisesMaxFrameZoom = 17.0;

  static bool _withinBoundingBox(LatLng point) {
    return point.latitude >= subdivisionSouthWest.latitude &&
        point.latitude <= subdivisionNorthEast.latitude &&
        point.longitude >= subdivisionSouthWest.longitude &&
        point.longitude <= subdivisionNorthEast.longitude;
  }

  /// True only when the point is inside the actual premises polygon.
  static bool containsInSubdivision(LatLng point) {
    return SubdivisionBoundary.contains(point, fallback: _withinBoundingBox);
  }

  /// The nearest point inside the premises — on the polygon once it has
  /// loaded (see [SubdivisionBoundary.nearestInside]), the bounding box
  /// before that.
  static LatLng clampToSubdivision(LatLng point) {
    final snapped = SubdivisionBoundary.nearestInside(point);
    if (snapped != null) return snapped;
    final lat = point.latitude
        .clamp(subdivisionSouthWest.latitude, subdivisionNorthEast.latitude)
        .toDouble();
    final lng = point.longitude
        .clamp(subdivisionSouthWest.longitude, subdivisionNorthEast.longitude)
        .toDouble();
    return LatLng(lat, lng);
  }
}
