import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

import 'package:monticello_villas_app/app/app.dart';
import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/config/subdivision_boundary.dart';
import 'package:monticello_villas_app/core/firebase/firebase_bootstrap.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sync_service.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/theme/theme_mode_controller.dart';

/// Runs one start-up step without letting it take the whole app down.
///
/// Everything in [main] happens BEFORE `runApp`, which makes this the most
/// dangerous code in the project: an unhandled exception here means `runApp` is
/// never reached, no widget tree is ever mounted, and the user sees a blank
/// screen with no error and nothing to tap. That is a strictly worse outcome
/// than starting with one subsystem degraded.
///
/// So each step is isolated. A failure is logged and start-up continues; the
/// feature that depends on it degrades on its own terms (the boundary loader
/// falls back to a bounding box, an unset Mapbox token shows an empty map
/// surface, and so on).
Future<void> _bootStep(String label, Future<void> Function() step) async {
  try {
    await step();
  } catch (error, stack) {
    debugPrint('Start-up step "$label" failed (continuing): $error');
    if (kDebugMode) debugPrintStack(stackTrace: stack);
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: AppColors.background,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  // `mapbox_maps_flutter` ships Android and iOS implementations only — there is
  // no web plugin — so on Flutter web this call reaches a method channel that
  // nothing is registered against and throws MissingPluginException. Guarded on
  // BOTH counts: skipped entirely off-device, and wrapped anyway in case the
  // native side is unavailable for some other reason.
  if (!kIsWeb) {
    await _bootStep('Mapbox access token', () async {
      MapboxOptions.setAccessToken(MapConstants.mapboxAccessToken);
    });
  }

  // Loaded before the first frame so no map screen can mount with an empty
  // boundary and fall back to the coarse bounding-box geofence.
  await _bootStep('Subdivision boundary', SubdivisionBoundary.load);

  await _bootStep('Firebase', initializeFirebaseApp);

  await _bootStep('Theme preferences', () async {
    // Reading currentUser is only meaningful once Firebase is up; if that step
    // failed this resolves to null and the controller loads its defaults.
    final uid = FirebaseAuth.instance.currentUser?.uid;
    await ThemeModeController.instance.load(userId: uid);
  });

  // Must come up before the first frame, not lazily when the SOS screen is
  // opened. An alert queued in a dead spot has to be delivered whether or not
  // the resident ever goes back to that screen — most will not; from their side
  // the emergency is already over.
  await _bootStep('Offline SOS queue', SosSyncService.instance.start);

  runApp(const MonticelloVillasApp());
}
