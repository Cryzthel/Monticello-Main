import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/features/property/data/lot_reference_points.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';

/// Loads and accumulates the lot → coordinate table.
///
/// Two tiers, merged at load:
///
///   1. SURVEYED — `assets/geo/lot_reference_points.geojson`, shipped with the
///      app. Authoritative, and empty until the estate supplies coordinates.
///   2. LEARNED — written on this device when a verified resident places a pin
///      on their OWN registered lot. Never overrides a surveyed point.
///
/// ── WHY LEARNING IS RESTRICTED TO THE RESIDENT'S OWN LOT ───────────────────
/// The tempting version learns from every report: someone selects "Block 5
/// Lot 19" and pins it, so record that. It corrupts the table almost
/// immediately — a resident reporting a break-in two doors down pins their
/// NEIGHBOUR'S house while the address says theirs, and the table now places
/// Lot 19 on the wrong plot. Restricting it to the reporter's own verified lot
/// makes the assertion unambiguous: the app already knows their address, and
/// the pin is where they say that address is.
///
/// ── DEVICE-LOCAL, LIKE THE RECENTS LIST ────────────────────────────────────
/// Learned points are never written to Firestore. A household's coordinates
/// staying on their own handset is the difference between a convenience cache
/// and a map of where every resident lives.
class LotReferenceStore {
  LotReferenceStore._();

  static const String _assetPath = 'assets/geo/lot_reference_points.geojson';

  /// Versioned so the format can change without having to read old entries.
  static const String _key = 'lot_reference_observations_v1';

  /// Observations are kept, not collapsed, so a single stray pin can be
  /// out-voted. See [_median].
  static const int maxObservations = 200;

  static List<LotReferencePoint> _surveyed = const [];
  static List<LotReferencePoint> _learned = const [];
  static bool _loaded = false;

  static bool get isLoaded => _loaded;

  /// The merged table. Surveyed points win over learned ones for the same lot.
  static LotLocator get locator {
    if (_surveyed.isEmpty && _learned.isEmpty) return const LotLocator.empty();

    final byKey = <String, LotReferencePoint>{};
    for (final point in _learned) {
      byKey[point.address.storageKey] = point;
    }
    for (final point in _surveyed) {
      byKey[point.address.storageKey] = point;
    }
    return LotLocator(byKey.values.toList(growable: false));
  }

  /// Never throws. A failure here costs the nearby tags, and losing them must
  /// not stop someone reporting an incident.
  static Future<void> load() async {
    _surveyed = await _loadSurveyed();
    _learned = await _loadLearned();
    _loaded = true;
  }

  static Future<List<LotReferencePoint>> _loadSurveyed() async {
    try {
      final raw = await rootBundle.loadString(_assetPath);
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const [];
      final features = decoded['features'];
      if (features is! List) return const [];

      final points = <LotReferencePoint>[];
      for (final feature in features) {
        final parsed = _parseFeature(feature);
        if (parsed != null) points.add(parsed);
      }
      return points;
    } catch (_) {
      return const [];
    }
  }

  static LotReferencePoint? _parseFeature(dynamic feature) {
    if (feature is! Map) return null;

    final properties = feature['properties'];
    final geometry = feature['geometry'];
    if (properties is! Map || geometry is! Map) return null;
    if (geometry['type'] != 'Point') return null;

    final coordinates = geometry['coordinates'];
    // GeoJSON is [longitude, latitude]. Getting this backwards puts the estate
    // off the coast of Somalia, so it is asserted rather than assumed.
    if (coordinates is! List || coordinates.length < 2) return null;
    final lon = (coordinates[0] as num?)?.toDouble();
    final lat = (coordinates[1] as num?)?.toDouble();
    if (lon == null || lat == null) return null;

    final phase = properties['phase']?.toString();
    final block = int.tryParse(properties['block']?.toString() ?? '');
    final lot = int.tryParse(properties['lot']?.toString() ?? '');
    if (phase == null || block == null || lot == null) return null;

    // A coordinate for a lot the estate does not have is a typo in the survey,
    // not an address. Dropping it here keeps a bad row out of the tag layer.
    if (!SubdivisionDirectory.exists(phase, block, lot)) return null;

    return LotReferencePoint(
      address: SubdivisionAddress(phase: phase, block: block, lot: lot),
      centre: LatLng(lat, lon),
      source: LotSource.surveyed,
    );
  }

  static Future<List<LotReferencePoint>> _loadLearned() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getStringList(_key) ?? const [];

      final grouped = <String, List<LatLng>>{};
      for (final entry in raw) {
        final parsed = _parseObservation(entry);
        if (parsed == null) continue;
        grouped.putIfAbsent(parsed.$1.storageKey, () => []).add(parsed.$2);
      }

      final points = <LotReferencePoint>[];
      grouped.forEach((key, observations) {
        final address = SubdivisionAddress.parse(key);
        if (address == null) return;
        if (!SubdivisionDirectory.exists(
            address.phase, address.block, address.lot)) {
          return;
        }
        points.add(LotReferencePoint(
          address: address,
          centre: _median(observations),
          source: LotSource.learned,
        ));
      });
      return points;
    } catch (_) {
      return const [];
    }
  }

  /// `phase/block/lot@lat,lon`.
  static (SubdivisionAddress, LatLng)? _parseObservation(String raw) {
    final at = raw.lastIndexOf('@');
    if (at <= 0) return null;

    final address = SubdivisionAddress.parse(raw.substring(0, at));
    if (address == null) return null;

    final parts = raw.substring(at + 1).split(',');
    if (parts.length != 2) return null;
    final lat = double.tryParse(parts[0]);
    final lon = double.tryParse(parts[1]);
    if (lat == null || lon == null) return null;

    return (address, LatLng(lat, lon));
  }

  /// Component-wise median, NOT a mean.
  ///
  /// One pin dropped on the way home should not drag a lot's position halfway
  /// down the street, and a mean lets it. With an even count this takes the
  /// lower of the two middles rather than averaging them, so the result is
  /// always a coordinate someone actually reported.
  static LatLng _median(List<LatLng> observations) {
    if (observations.length == 1) return observations.single;
    final lats = observations.map((p) => p.latitude).toList()..sort();
    final lons = observations.map((p) => p.longitude).toList()..sort();
    final mid = (observations.length - 1) ~/ 2;
    return LatLng(lats[mid], lons[mid]);
  }

  /// Records that [address] — which must be the resident's OWN verified lot —
  /// is at [point].
  ///
  /// Callers are responsible for that check; this cannot verify it. See the
  /// class doc for why it matters.
  static Future<void> rememberOwnLot(
    SubdivisionAddress address,
    LatLng point,
  ) async {
    if (!SubdivisionDirectory.exists(address.phase, address.block, address.lot)) {
      return;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = List<String>.from(prefs.getStringList(_key) ?? const []);
      raw.add('${address.storageKey}@'
          '${point.latitude.toStringAsFixed(6)},'
          '${point.longitude.toStringAsFixed(6)}');

      // Oldest first out, so a lot that moves (a correction) converges rather
      // than being out-voted forever by stale observations.
      while (raw.length > maxObservations) {
        raw.removeAt(0);
      }
      await prefs.setStringList(_key, raw);
      _learned = await _loadLearned();
    } catch (_) {
      // A lost observation costs one tag. Never worth surfacing.
    }
  }

  static Future<void> clearLearned() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_key);
      _learned = const [];
    } catch (_) {
      // Ignored for the same reason as above.
    }
  }

  /// Test seam. Replaces both tiers without touching disk or the bundle.
  static void debugSeed({
    List<LotReferencePoint> surveyed = const [],
    List<LotReferencePoint> learned = const [],
  }) {
    _surveyed = surveyed;
    _learned = learned;
    _loaded = true;
  }
}
