import 'package:flutter/foundation.dart';

/// ─────────────────────── REQUEST PACE ───────────────────────
/// How long this device's network round trips are actually taking.
///
/// ── WHY AN ESTIMATE AND NOT A REAL PERCENTAGE ─────────────────────────────
/// A Firestore write reports no progress. There is no byte count to divide, no
/// `onSendProgress`, no intermediate state between "sent" and "acknowledged" —
/// so a progress bar over one cannot be measuring the request. The choice is
/// between an indeterminate spinner, which tells a resident nothing about how
/// long they are waiting, and a bar paced by how long these requests HAVE been
/// taking on this connection.
///
/// This is that second thing, and it is honest in the way that matters: the bar
/// only ever *predicts*, it never claims completion. It approaches the finish
/// asymptotically and is snapped to 100% by the request's real completion — so
/// on a fast connection it fills fast and finishes early, on a slow one it
/// paces out to where the last few writes landed, and if the network stalls it
/// visibly slows to a crawl instead of sitting at a lie like 99%.
///
/// ── HOW IT LEARNS ─────────────────────────────────────────────────────────
/// An exponentially weighted moving average over the last few round trips.
/// [_alpha] at 0.35 means a request roughly two thirds different from the
/// running estimate moves it most of the way there within three samples: fast
/// enough to follow a resident walking out of Wi-Fi onto mobile data, slow
/// enough that one unlucky spike does not repace every bar in the app.
///
/// The clamps are not cosmetic. Without a floor, a run of warm-cache writes
/// drives the estimate toward zero and the next bar completes before it can be
/// seen; without a ceiling, one 40-second timeout would leave every subsequent
/// bar apparently frozen.
class RequestPace extends ChangeNotifier {
  RequestPace._();

  static final RequestPace instance = RequestPace._();

  /// What a first-run app assumes before it has measured anything: a middling
  /// mobile round trip. Deliberately not optimistic — a bar that starts too
  /// fast and stalls reads worse than one that starts steady and finishes
  /// early.
  static const Duration seed = Duration(milliseconds: 1100);

  static const Duration floor = Duration(milliseconds: 350);
  static const Duration ceiling = Duration(seconds: 12);

  static const double _alpha = 0.35;

  Duration _estimate = seed;

  /// The current prediction for one round trip. Read once when a bar starts;
  /// re-reading mid-flight would repace a bar that is already running.
  Duration get estimate => _estimate;

  /// Number of round trips folded in so far. Exposed so a caller can tell a
  /// measured estimate from the seed.
  int get samples => _samples;
  int _samples = 0;

  /// Times [request] and folds its real duration into the estimate.
  ///
  /// A throw is timed too, and on purpose: a request that failed after eight
  /// seconds is evidence about this connection, and discarding it would leave
  /// the next bar paced for a network that is no longer there. The error is
  /// rethrown untouched — this measures, it does not handle.
  Future<T> measure<T>(Future<T> Function() request) async {
    final watch = Stopwatch()..start();
    try {
      return await request();
    } finally {
      watch.stop();
      record(watch.elapsed);
    }
  }

  /// Folds one observed round trip into the running estimate.
  void record(Duration observed) {
    if (observed < Duration.zero) return;
    final blended = _samples == 0
        // The seed is a guess, not a measurement. The first real sample
        // replaces it outright rather than being averaged against it.
        ? observed
        : Duration(
            microseconds: (_estimate.inMicroseconds * (1 - _alpha) +
                    observed.inMicroseconds * _alpha)
                .round(),
          );

    _samples++;
    final clamped = blended < floor
        ? floor
        : (blended > ceiling ? ceiling : blended);
    if (clamped == _estimate) return;
    _estimate = clamped;
    notifyListeners();
  }

  /// Back to first-run state. For sign-out, where the next resident may be on
  /// an entirely different connection, and for tests.
  void reset() {
    _estimate = seed;
    _samples = 0;
    notifyListeners();
  }
}
