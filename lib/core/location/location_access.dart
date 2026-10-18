import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// Everything the app can know about whether it may read the resident's
/// position, collapsed into the answers a screen actually acts on.
///
/// geolocator reports permission and service state separately, and a screen
/// that checks only one of them gets the other case wrong: "permission granted"
/// with location services switched off produces no fix at all, and looks
/// exactly like a broken map.
enum LocationAccess {
  /// Permission held, PRECISE, and services on. Fixes will arrive.
  granted,

  /// Permission held but only APPROXIMATE (Android 12+ "Approximate", iOS 14+
  /// "Precise: Off"). Fixes arrive, but the OS deliberately blurs them to a
  /// few hundred metres to a few kilometres — no setting in the app can make
  /// that house-level. Only the resident switching precise on can.
  approximate,

  /// Not granted, but the system prompt can still be shown.
  denied,

  /// Refused for good ("Don't ask again" on Android, any refusal on iOS). The
  /// system prompt will not appear again; only the Settings app can undo it.
  deniedForever,

  /// The device's location switch is off. Permission is moot until it is on.
  servicesOff,

  /// The platform cannot answer — most often a build whose manifest does not
  /// declare a location permission, which geolocator reports by throwing.
  unavailable;

  /// Whether the map may show the resident at all — precise or not.
  bool get isGranted =>
      this == LocationAccess.granted || this == LocationAccess.approximate;

  /// Whether asking would put the system prompt on screen. Only true for the
  /// one state where the OS will still show it.
  bool get canPrompt => this == LocationAccess.denied;

  /// Folds geolocator's answers into one. Service state wins: with the switch
  /// off, nothing a permission dialog says can produce a fix. [precise] only
  /// matters once permission is held.
  static LocationAccess resolve({
    required bool servicesEnabled,
    required LocationPermission permission,
    bool precise = true,
  }) {
    if (!servicesEnabled) return LocationAccess.servicesOff;
    switch (permission) {
      case LocationPermission.always:
      case LocationPermission.whileInUse:
        return precise ? LocationAccess.granted : LocationAccess.approximate;
      case LocationPermission.deniedForever:
        return LocationAccess.deniedForever;
      case LocationPermission.denied:
        return LocationAccess.denied;
      case LocationPermission.unableToDetermine:
        return LocationAccess.unavailable;
    }
  }
}

/// The platform calls [LocationAccessService] makes, behind a seam so widget
/// tests can drive every permission state without a device.
abstract class LocationPlatform {
  Future<bool> isLocationServiceEnabled();
  Future<LocationPermission> checkPermission();
  Future<LocationPermission> requestPermission();
  Future<LocationAccuracyStatus> getLocationAccuracy();
  Future<LocationAccuracyStatus> requestTemporaryFullAccuracy();
  Future<bool> openAppSettings();
  Future<bool> openLocationSettings();
}

class _GeolocatorPlatform implements LocationPlatform {
  const _GeolocatorPlatform();

  @override
  Future<bool> isLocationServiceEnabled() =>
      Geolocator.isLocationServiceEnabled();
  @override
  Future<LocationPermission> checkPermission() => Geolocator.checkPermission();
  @override
  Future<LocationPermission> requestPermission() =>
      Geolocator.requestPermission();
  @override
  Future<LocationAccuracyStatus> getLocationAccuracy() =>
      Geolocator.getLocationAccuracy();
  @override
  Future<LocationAccuracyStatus> requestTemporaryFullAccuracy() =>
      Geolocator.requestTemporaryFullAccuracy(
        // Must match a key in Info.plist's
        // NSLocationTemporaryUsageDescriptionDictionary.
        purposeKey: LocationAccessService.preciseLocationPurposeKey,
      );
  @override
  Future<bool> openAppSettings() => Geolocator.openAppSettings();
  @override
  Future<bool> openLocationSettings() => Geolocator.openLocationSettings();
}

/// Reads and requests location access through the app's one location plugin.
///
/// geolocator, not permission_handler: the panic button, the incident picker
/// and the map all already ask through it, and two plugins asking for the same
/// permission produce two different system prompts. Every request here goes
/// straight to the OS dialog — there is no in-app step in front of it.
class LocationAccessService {
  LocationAccessService._();

  /// Swapped in tests; the real platform everywhere else.
  static LocationPlatform platform = const _GeolocatorPlatform();

  /// The Info.plist purpose key for iOS's one-off "use precise location"
  /// dialog.
  static const String preciseLocationPurposeKey = 'HomeMap';

  /// The current state, WITHOUT prompting. Safe to call on every resume.
  static Future<LocationAccess> check() async {
    try {
      final services = await platform.isLocationServiceEnabled();
      final permission = await platform.checkPermission();
      final held = permission == LocationPermission.whileInUse ||
          permission == LocationPermission.always;
      return LocationAccess.resolve(
        servicesEnabled: services,
        permission: permission,
        // Only asked once permission is held; before that there is nothing
        // for the OS to report accuracy about.
        precise: !held || await _isPrecise(),
      );
    } catch (_) {
      // PermissionDefinitionsNotFoundException and friends: the build cannot
      // ask at all. Reported as its own state rather than as "denied", which
      // would send the resident to a Settings page with nothing to change.
      return LocationAccess.unavailable;
    }
  }

  /// Shows the system prompt if — and only if — the OS will still show it,
  /// then reports where that left things. From [LocationAccess.approximate]
  /// it asks for precise instead.
  static Future<LocationAccess> request() async {
    final current = await check();
    if (current == LocationAccess.approximate) return requestPrecise();
    if (!current.canPrompt) return current;
    try {
      await platform.requestPermission();
      return check();
    } catch (_) {
      return LocationAccess.unavailable;
    }
  }

  /// Asks the OS to upgrade approximate location to precise.
  ///
  /// Android 12+: requesting the permission again while only COARSE is held
  /// shows the system's own "Change to precise location" dialog (geolocator
  /// asks for FINE and COARSE together). iOS 14+: the one-off full-accuracy
  /// dialog, worded by the Info.plist entry under [preciseLocationPurposeKey].
  static Future<LocationAccess> requestPrecise() async {
    try {
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
        await platform.requestTemporaryFullAccuracy();
      } else {
        await platform.requestPermission();
      }
    } catch (_) {
      // Fall through to whatever the OS now reports.
    }
    return check();
  }

  /// Precise unless the OS positively says reduced. A platform that cannot
  /// answer is treated as precise: the alternative nags every such phone.
  static Future<bool> _isPrecise() async {
    try {
      return await platform.getLocationAccuracy() !=
          LocationAccuracyStatus.reduced;
    } catch (_) {
      return true;
    }
  }

  static Future<bool> openAppSettings() async {
    try {
      return await platform.openAppSettings();
    } catch (_) {
      return false;
    }
  }

  static Future<bool> openLocationSettings() async {
    try {
      return await platform.openLocationSettings();
    } catch (_) {
      return false;
    }
  }
}
