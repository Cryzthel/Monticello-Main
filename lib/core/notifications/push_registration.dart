import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show MethodChannel;

/// Registers this device to receive push, and keeps the token current.
///
/// ── THE HALF THAT WAS MISSING ─────────────────────────────────────────────
/// The send side has existed for a long time: `functions/index.js` pushes to
/// a resident on every dispatch-stage change and on each broadcast. It reads
/// the device token from **`users/{uid}.fcmToken`** — a single string, not a
/// list — and when it finds nothing it returns `{delivered: false, reason:
/// "no-token"}` and moves on.
///
/// Nothing in this app had ever written that field. Every push the backend
/// has sent since it was deployed took the `no-token` branch, which is why
/// notifications "did not work" without anything appearing broken: the
/// server was reporting the truth, and the truth was that no device had ever
/// registered.
///
/// ── WHY THE FIELD NAME IS NOT NEGOTIABLE ──────────────────────────────────
/// `fcmToken`, on `users/{uid}`, singular. That is what the deployed
/// functions read, and functions cannot currently be redeployed on this
/// project's billing plan, so the client is the side that has to match. A
/// tidier shape — a `fcmTokens` array supporting several devices, the way
/// `staff_accounts` is written for — is the right end state and is NOT what
/// this writes, because it would be read by nothing.
///
/// `users/{userId}` already allows `write: if isOwner(userId)` in
/// firestore.rules, so no rules change is needed and none was made.
class PushRegistration {
  PushRegistration._();

  static final PushRegistration instance = PushRegistration._();

  StreamSubscription<String>? _refreshSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedSub;
  bool _started = false;

  /// How long sign-out waits on each network step of [clear].
  ///
  /// A Firestore write's future resolves on SERVER acknowledgement, not on
  /// being queued, so offline it never resolves at all — and [clear] runs on
  /// the path to `signOut()`. Unbounded, a resident in a dead zone taps
  /// "Sign out" and nothing happens, ever.
  static const _clearTimeout = Duration(seconds: 5);

  /// Messages that arrive while the app is in the foreground.
  ///
  /// FCM does NOT draw a system notification for these on Android — the OS
  /// suppresses them on the assumption the app will show its own UI. The
  /// stream is exposed rather than handled here so the widget layer can
  /// decide: a banner on the dashboard is a different thing from a toast
  /// over the panic screen, and this service has no business knowing which
  /// is on top.
  final foreground = StreamController<RemoteMessage>.broadcast();

  /// Taps on a notification that opened or resumed the app.
  final opened = StreamController<RemoteMessage>.broadcast();

  RemoteMessage? _initialMessage;

  /// The notification that launched the app from terminated, at most once.
  ///
  /// For a listener that subscribed to [opened] after [start] had already
  /// emitted it. Taking it clears it, so the tap is acted on once whichever
  /// path sees it first.
  RemoteMessage? takeInitialMessage() {
    final message = _initialMessage;
    _initialMessage = null;
    return message;
  }

  /// Safe to call more than once; only the first call wires anything up.
  ///
  /// Never throws. Push is an enhancement on top of a UI that already reads
  /// its state from Firestore listeners — a resident who denies permission,
  /// or whose device has no Play Services, still sees every status change
  /// the moment they open the app. Letting this take down start-up would
  /// trade the whole product for one of its conveniences.
  Future<void> start() async {
    if (_started) return;
    _started = true;

    try {
      final messaging = FirebaseMessaging.instance;

      // iOS and Android 13+ both gate notifications behind a runtime prompt.
      // Asked here, at sign-in, rather than on first launch: a permission
      // dialog shown before the resident knows what the app does is the one
      // most reliably denied, and a denial is sticky.
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('PushRegistration: permission denied');
        return;
      }

      // A resident who switched push OFF in Settings stays off across sign-ins:
      // the OS permission may still be granted, but this device does not put
      // its token where the server will find it.
      if (await _optedOut()) {
        debugPrint('PushRegistration: resident has push switched off');
      } else {
        await _writeToken(await messaging.getToken());
      }

      // A token is not stable. It rotates when the app is restored to a new
      // device, reinstalled, or when its data is cleared — and a stale token
      // fails silently at the server, which is the worst failure mode this
      // feature has. Following the refresh stream is what keeps the one
      // stored value true.
      _refreshSub?.cancel();
      _refreshSub = messaging.onTokenRefresh.listen(_writeToken);

      _foregroundSub?.cancel();
      _foregroundSub = FirebaseMessaging.onMessage.listen(foreground.add);
      // Held, not fire-and-forget: [clear] resets `_started`, so the next
      // sign-in runs this again, and an unheld listener would deliver every
      // tap once per sign-in since launch.
      _openedSub?.cancel();
      _openedSub = FirebaseMessaging.onMessageOpenedApp.listen(opened.add);

      // The notification that launched a terminated app arrives once, here,
      // rather than on the stream.
      // Held as well as emitted: `start()` is not awaited, so whether the
      // shell has subscribed to [opened] by now is a race, and a broadcast
      // stream drops what nobody is listening for. See [takeInitialMessage].
      final initial = await messaging.getInitialMessage();
      if (initial != null) {
        _initialMessage = initial;
        opened.add(initial);
      }
    } catch (error, stack) {
      debugPrint('PushRegistration: start failed ($error)');
      if (kDebugMode) debugPrintStack(stackTrace: stack);
    }
  }

  /// The Settings switch turned ON: the native OS permission dialog, now, then
  /// this device's token where the server reads it.
  ///
  /// `requestPermission` IS the system dialog on iOS and Android 13+ when the
  /// question has not been answered yet; there is no in-app step before it.
  /// Once answered, the OS returns the stored answer without a dialog — which
  /// is why a denial comes back as [PushPermission.denied] for the caller to
  /// offer Settings rather than as a silent no-op.
  Future<PushPermission> enable() async {
    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (!_allows(settings.authorizationStatus)) return PushPermission.denied;
      _optedOutCache = false;
      if (_started) {
        await _writeToken(await FirebaseMessaging.instance.getToken());
      } else {
        await start();
      }
      return PushPermission.granted;
    } catch (error) {
      debugPrint('PushRegistration: enable failed ($error)');
      return PushPermission.unavailable;
    }
  }

  /// The Settings switch turned OFF: stop pushes to this device.
  ///
  /// The token field is removed (the server finds nothing and sends nothing)
  /// and the token itself is revoked at FCM. The OS permission is left alone
  /// — apps cannot revoke their own — so switching back on needs no dialog.
  Future<void> disable() async {
    _optedOutCache = true;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid != null) {
      try {
        await FirebaseFirestore.instance
            .collection('users')
            .doc(uid)
            .set({'fcmToken': FieldValue.delete()}, SetOptions(merge: true))
            .timeout(_clearTimeout);
      } catch (error) {
        debugPrint('PushRegistration: token field delete failed ($error)');
      }
    }
    try {
      await FirebaseMessaging.instance.deleteToken().timeout(_clearTimeout);
    } catch (error) {
      debugPrint('PushRegistration: token revoke failed ($error)');
    }
  }

  static const MethodChannel _settingsChannel =
      MethodChannel('monticello/notifications');

  /// Opens this app's notification settings page in the OS. True when it
  /// opened; false when the platform has no such page (iOS — use the general
  /// app settings page there, which lists Notifications first).
  ///
  /// The re-trigger for a REVOKED permission. Both platforms remember a
  /// denial and stop showing the dialog for it — iOS after one "Don't
  /// Allow", Android after a second, and Android 12 and below never had a
  /// runtime dialog at all — so [enable] returning denied means no dialog
  /// can appear. This page is the native prompt that remains.
  Future<bool> openSystemSettings() async {
    try {
      return await _settingsChannel.invokeMethod<bool>('openSettings') ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Whether the OS currently lets this app show notifications, without
  /// asking. False also when the platform cannot say.
  Future<bool> isAllowedByOs() async {
    try {
      final settings =
          await FirebaseMessaging.instance.getNotificationSettings();
      return _allows(settings.authorizationStatus);
    } catch (_) {
      return false;
    }
  }

  static bool _allows(AuthorizationStatus status) =>
      status == AuthorizationStatus.authorized ||
      status == AuthorizationStatus.provisional;

  bool? _optedOutCache;

  /// `users/{uid}.notificationsEnabled == false`, the Settings switch.
  Future<bool> _optedOut() async {
    final cached = _optedOutCache;
    if (cached != null) return cached;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return false;
    try {
      final doc = await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .get()
          .timeout(_clearTimeout);
      return doc.data()?['notificationsEnabled'] == false;
    } catch (_) {
      // Unknown means registered: a missed push is worse than an unwanted one
      // for a safety app, and the switch can still turn it off.
      return false;
    }
  }

  Future<void> _writeToken(String? token) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || token == null || token.isEmpty) return;
    if (_optedOutCache == true) return;
    try {
      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .set({'fcmToken': token}, SetOptions(merge: true));
      debugPrint('PushRegistration: token registered');
    } catch (error) {
      // Offline, this is queued by Firestore and lands later; any other
      // failure means this device misses pushes until the next sign-in,
      // which is a degraded feature rather than a broken app.
      debugPrint('PushRegistration: token write failed ($error)');
    }
  }

  /// Drops this device's token on sign-out.
  ///
  /// Not merely tidy: the field is keyed by USER, not by device, so leaving
  /// it behind means the next dispatch push for that resident is delivered
  /// to a phone somebody else is now holding. On a shared or handed-down
  /// handset that is someone's address and incident details on a stranger's
  /// lock screen.
  Future<void> clear() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    await _refreshSub?.cancel();
    await _foregroundSub?.cancel();
    await _openedSub?.cancel();
    _refreshSub = null;
    _foregroundSub = null;
    _openedSub = null;
    _started = false;
    // The next person to sign in on this handset has their own preference.
    _optedOutCache = null;
    if (uid == null) return;

    // Two independent steps, each bounded, so one failing never skips the
    // other. Revoking the token at FCM is the stronger of the two: even if
    // the field delete is still queued when auth is gone (and is then
    // rejected by rules), a revoked token is undeliverable at the server.
    try {
      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .set({'fcmToken': FieldValue.delete()}, SetOptions(merge: true))
          .timeout(_clearTimeout);
    } catch (error) {
      debugPrint('PushRegistration: token field delete failed ($error)');
    }
    try {
      await FirebaseMessaging.instance.deleteToken().timeout(_clearTimeout);
    } catch (error) {
      debugPrint('PushRegistration: token revoke failed ($error)');
    }
  }
}

/// What [PushRegistration.enable] got from the OS.
enum PushPermission {
  /// Allowed; the token is registered.
  granted,

  /// Refused — now, or earlier and remembered by the OS. The app cannot ask
  /// again; only the system Settings page can change it.
  denied,

  /// No messaging on this device (no Play Services, a simulator).
  unavailable,
}
