import 'package:firebase_auth/firebase_auth.dart';
import 'package:geolocator/geolocator.dart';

import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_queue.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sync_service.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/features/property/services/property_storage.dart';

/// What actually happened to an alert, as far as the app can honestly tell.
///
/// There is no `failed`. Once the payload is on disk the emergency is recorded
/// and will be retried until it lands, so "we could not send it" stopped being
/// a truthful thing to display — the only remaining distinction is whether the
/// guardhouse has it NOW or has it PENDING. The one genuine failure left is
/// being unable to build a payload at all, which throws.
enum SosDispatchOutcome {
  /// The server acknowledged the write. Security can see it.
  delivered,

  /// Held in the encrypted queue. Firestore's own cache may also be holding a
  /// copy; either way delivery is automatic once there is a route out.
  queued,
}

/// Raises a panic alert to the security portal.
///
/// ONE definition of the emergency payload, deliberately. This was a private
/// method on the panic screen's State, which meant any second surface that
/// wanted to raise an alert — the dashboard's SOS countdown sheet, for one —
/// had to copy the Firestore write. Two copies of an emergency payload is two
/// schemas to keep in step with `functions/index.js` and the security portal,
/// and the copy that drifts is the one that silently stops paging anybody.
class PanicAlertService {
  PanicAlertService._();

  /// Collection watched by the `onPanicAlertCreate` Cloud Function, which fans
  /// the alert out to on-duty security over FCM.
  static const String collection = 'panic_alerts';

  /// How long to wait for a GPS fix before giving up and sending without one.
  static const Duration locationTimeout = Duration(seconds: 4);

  /// Raises the alert.
  ///
  /// ── WHY THIS NO LONGER JUST AWAITS A FIRESTORE WRITE ──────────────────
  /// It used to be `await collection.add({...})`, and offline that does not
  /// fail — it HANGS. Firestore's future resolves on server acknowledgement,
  /// so with no signal it never resolves at all, and the panic screen sat on
  /// "Sending your alert to the guardhouse…" indefinitely. No error, no
  /// retry, no way for the resident to learn that nobody had been paged. That
  /// is the worst of the three possible outcomes: a failure that is dressed as
  /// progress, on the one screen where a resident is deciding whether to keep
  /// waiting or find another way to call for help.
  ///
  /// Now the payload is captured and written to encrypted storage BEFORE any
  /// network attempt, the write is raced against a timeout, and the caller is
  /// told which of the two true things happened. Nothing is lost by pressing
  /// the button in a dead spot.
  ///
  /// Throws only if the alert could not be built — no signed-in resident. A
  /// caller must still surface that, because it is the one case where nothing
  /// was recorded anywhere.
  static Future<SosDispatchOutcome> dispatch({
    String emergencyType = 'general',
  }) async {
    return dispatchPayload(await buildPayload(emergencyType: emergencyType));
  }

  /// [dispatch] with the payload supplied.
  ///
  /// Split out so a caller can keep the payload it just sent. The panic screen
  /// needs it: if the outcome is [SosDispatchOutcome.queued] it has to be able
  /// to render that same emergency into an SMS, and rebuilding it afterwards
  /// would take a second GPS fix and produce a second alertId — a different
  /// emergency, as far as every duplicate guard in this feature is concerned.
  static Future<SosDispatchOutcome> dispatchPayload(SosPayload payload) async {
    // Durability first. If the process dies on the next line, the alert is
    // still on disk and the sync service will deliver it.
    await SosQueue.enqueue(payload);

    final delivered = await SosSyncService.deliverFirst(payload);
    if (delivered) {
      await SosQueue.remove(payload.alertId);
      return SosDispatchOutcome.delivered;
    }
    return SosDispatchOutcome.queued;
  }

  /// Assembles the emergency from whatever is known right now.
  ///
  /// Every lookup here is cached-or-best-effort by design. A resident in an
  /// emergency cannot wait on a profile fetch, and an alert carrying a blank
  /// name still carries the lot number that tells a guard where to go.
  static Future<SosPayload> buildPayload({
    String emergencyType = 'general',
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('Not signed in');

    final property = PropertyStorage.cachedFor(user.uid) ??
        await PropertyStorage.loadFullForUser(user.uid);
    final profile = UserProfileService.instance.profile;
    final location = await _bestEffortLocation();
    final capturedAt = DateTime.now();

    return SosPayload(
      // uid + millisecond stamp. Unique per press, stable across every retry
      // and every delivery channel — see the note on SosPayload.alertId.
      alertId: '${user.uid}_${capturedAt.millisecondsSinceEpoch}',
      residentUid: user.uid,
      residentName: profile?.name ?? user.displayName ?? '',
      residentPhone: profile?.phone ?? '',
      propertyPhase: property?.phase ?? '',
      propertyBlock: property?.block ?? '',
      propertyLot: property?.lot ?? '',
      propertyLabel: property != null
          ? 'Phase ${property.phase} • Block ${property.block} • Lot ${property.lot}'
          : null,
      capturedAt: capturedAt,
      emergencyType: emergencyType,
      lat: location?['lat'],
      lng: location?['lng'],
    );
  }

  /// A GPS fix if one can be had quickly.
  ///
  /// Never blocks the alert. A resident with location services off, or standing
  /// somewhere with no fix, still needs security paged — the property record on
  /// the alert already says which lot to go to.
  static Future<Map<String, double>?> _bestEffortLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;

      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm != LocationPermission.always &&
          perm != LocationPermission.whileInUse) {
        return null;
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      ).timeout(locationTimeout);
      return {'lat': pos.latitude, 'lng': pos.longitude};
    } catch (_) {
      return null;
    }
  }
}
