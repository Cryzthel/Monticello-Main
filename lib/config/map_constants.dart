import 'package:latlong2/latlong.dart';

/// Subdivision map defaults. Update [subdivisionCenter] to match your
/// Leaflet / GIS survey centroid for Monticello Villas.
class MapConstants {
  MapConstants._();

  /// Approximate map focus (southern Metro Manila / Cavite corridor).
  /// Replace with exact subdivision coordinates when available.
  static const LatLng subdivisionCenter = LatLng(14.4198, 120.9261);

  /// Approximate operational boundary for Monticello Villas.
  /// Update these corners if you have surveyed GIS coordinates.
  static const LatLng subdivisionSouthWest = LatLng(14.4158, 120.9218);
  static const LatLng subdivisionNorthEast = LatLng(14.4239, 120.9306);

  static const double defaultZoom = 16.5;
  static const double minZoom = 15;
  static const double maxZoom = 19;

  static bool containsInSubdivision(LatLng point) {
    return point.latitude >= subdivisionSouthWest.latitude &&
        point.latitude <= subdivisionNorthEast.latitude &&
        point.longitude >= subdivisionSouthWest.longitude &&
        point.longitude <= subdivisionNorthEast.longitude;
  }

  static LatLng clampToSubdivision(LatLng point) {
    final lat = point.latitude
        .clamp(subdivisionSouthWest.latitude, subdivisionNorthEast.latitude)
        .toDouble();
    final lng = point.longitude
        .clamp(subdivisionSouthWest.longitude, subdivisionNorthEast.longitude)
        .toDouble();
    return LatLng(lat, lng);
  }
}
