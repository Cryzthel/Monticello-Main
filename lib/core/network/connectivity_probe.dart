import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

/// Answers one question at start-up: is there a network path at all?
///
/// ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
/// Not for deciding whether a feature works. It exists so the splash knows
/// whether waiting is worth anything.
///
/// Every pre-dashboard read ends in a Firestore `.get()`, and a `.get()` with
/// no cached document and no reachable server **does not fail** — it waits.
/// AuthGate already caps each one at eight seconds so a dead connection
/// degrades instead of hanging forever, but eight seconds is the right budget
/// for "the network is slow" and completely the wrong one for "the phone is
/// in aeroplane mode", where the answer is known before the first byte is
/// sent. A resident opening the app on the underground should reach the
/// dashboard immediately, with whatever is cached, not watch an emblem for
/// half a minute while three reads each time out in turn.
///
/// ── WHAT IT CANNOT TELL YOU ───────────────────────────────────────────────
/// Stated plainly, because the failure mode is subtle: `checkConnectivity()`
/// reports the state of the device's INTERFACES, not reachability. A phone
/// attached to a hotel wifi captive portal reports [ConnectivityResult.wifi]
/// and cannot reach Firebase; a phone on a metered connection the user has
/// blocked for this app reports mobile data and cannot either.
///
/// So [isOnline] returning true means "waiting might be worthwhile", never
/// "the server is reachable". Only `false` is a firm answer. Every caller is
/// built on that asymmetry: an offline result SHORTENS a timeout, and an
/// online result changes nothing — the existing deadlines still do the real
/// work. Nothing here is a precondition for anything; a probe that fails is
/// treated as "online" precisely so it cannot block a start-up on its own.
class ConnectivityProbe {
  ConnectivityProbe._();

  /// The probe's own deadline.
  ///
  /// A platform-channel round trip to the OS connectivity service is normally
  /// sub-millisecond. If it has not answered in a second something is wrong
  /// with the channel, and the start-up path is the last place to find that
  /// out slowly.
  static const Duration _probeTimeout = Duration(seconds: 1);

  /// True unless the device reports no interface at all.
  ///
  /// Never throws and never hangs: any failure, including the probe timing
  /// out, resolves to `true` so that a broken probe degrades to exactly the
  /// behaviour this app had before it existed.
  static Future<bool> isOnline() async {
    try {
      final result =
          await Connectivity().checkConnectivity().timeout(_probeTimeout);
      return result != ConnectivityResult.none;
    } on TimeoutException {
      debugPrint('ConnectivityProbe: platform channel did not answer in '
          '$_probeTimeout — assuming online');
      return true;
    } catch (error) {
      debugPrint('ConnectivityProbe: failed ($error) — assuming online');
      return true;
    }
  }
}
