import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/location/location_access.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The small, non-blocking pill a map shows while location access is missing.
///
/// There is no in-app pre-prompt any more: the map asks the OS directly on
/// init. This chip is what is left AFTER the system has answered, and each
/// state's tap does the one thing that can change it — see [resolve].
///
/// Solid white like the map controls, not frosted like the premises label:
/// it is something to tap, not something to read past. Hidden entirely when
/// access is granted.
class LocationStatusChip extends StatelessWidget {
  const LocationStatusChip({
    super.key,
    required this.access,
    required this.onTap,
  });

  final LocationAccess access;
  final VoidCallback onTap;

  /// The few words the chip carries for each state.
  static String labelFor(LocationAccess access) {
    switch (access) {
      case LocationAccess.denied:
        return 'Show my location';
      case LocationAccess.deniedForever:
        return 'Location blocked · Settings';
      case LocationAccess.servicesOff:
        return 'Location is off · Turn on';
      case LocationAccess.unavailable:
        return 'Location unavailable';
      case LocationAccess.approximate:
        return 'Approximate location · Use precise';
      case LocationAccess.granted:
        return '';
    }
  }

  /// What tapping the chip does, then where that left things:
  ///
  ///   • denied         → the system prompt again (the OS decides whether it
  ///                      still shows one);
  ///   • deniedForever  → the app's page in Settings — no prompt can appear;
  ///   • servicesOff    → the device location switch;
  ///   • approximate    → the OS's own "use precise location" dialog;
  ///   • unavailable    → nothing; there is no action that fixes it.
  ///
  /// For the two Settings paths the answer only changes after the resident
  /// comes back, which the map picks up on resume.
  static Future<LocationAccess> resolve(LocationAccess access) async {
    switch (access) {
      case LocationAccess.denied:
        return LocationAccessService.request();
      case LocationAccess.deniedForever:
        await LocationAccessService.openAppSettings();
        return access;
      case LocationAccess.servicesOff:
        await LocationAccessService.openLocationSettings();
        return access;
      case LocationAccess.approximate:
        return LocationAccessService.requestPrecise();
      case LocationAccess.unavailable:
      case LocationAccess.granted:
        return access;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Shown for approximate too: the pin is on the map, but blurred to a
    // circle the size of a neighbourhood, and only the resident can fix it.
    if (access == LocationAccess.granted) return const SizedBox.shrink();
    final blocked = access != LocationAccess.denied &&
        access != LocationAccess.approximate;
    final label = labelFor(access);

    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: AppColors.backgroundSecondary,
        shape: const StadiumBorder(
          side: BorderSide(color: AppColors.innerStroke),
        ),
        elevation: 2,
        shadowColor: AppColors.glassShadow,
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  blocked ? PhosphorIconsFill.gpsSlash : PhosphorIconsFill.gps,
                  size: 14,
                  color: blocked ? AppColors.danger : AppColors.accentPrimary,
                ),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: sfPro(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
