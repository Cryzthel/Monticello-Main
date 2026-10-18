import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/auth/widgets/verification_lock.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/panic_alert_service.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_alert_status.dart';
import 'package:monticello_villas_app/features/panic_button/widgets/sos_countdown_sheet.dart';

/// Records dispatch attempts, and can be made to fail on demand.
class _Dispatcher {
  int calls = 0;
  bool shouldFail = false;

  /// What a successful call reports back. `queued` is the offline path — the
  /// alert is on disk and will send itself — and the sheet has to treat it as
  /// a success, not as a failure with nicer wording.
  SosDispatchOutcome outcome = SosDispatchOutcome.delivered;

  static const String alertId = 'uid_1756300000000';

  Future<SosDispatchReceipt> call() async {
    calls++;
    // The only real failure left is being unable to build a payload at all;
    // everything network-shaped resolves to `queued`.
    if (shouldFail) throw StateError('not signed in');
    return SosDispatchReceipt(
      outcome: outcome,
      payload: SosPayload(
        alertId: alertId,
        residentUid: 'uid',
        residentName: 'Ana Cruz',
        residentPhone: '',
        propertyPhase: '1',
        propertyBlock: '4',
        propertyLot: '12',
        propertyLabel: null,
        capturedAt: DateTime(2026, 8, 27, 21, 5),
        emergencyType: 'general',
      ),
    );
  }
}

/// Stands in for `watchSosAlert`: records which alert was subscribed to, and
/// lets a test push the snapshots a guard's actions would produce.
class _StatusFeed {
  final _controller = StreamController<SosAlertStatus>.broadcast();
  final List<String> watched = [];

  Stream<SosAlertStatus> call(String alertId) {
    watched.add(alertId);
    return _controller.stream;
  }

  void emit(SosAlertStatus status) => _controller.add(status);

  Future<void> close() => _controller.close();
}

// NO pumpAndSettle ANYWHERE IN THIS FILE.
//
// The sheet runs a `repeat(reverse: true)` pulse behind the dial for as long as
// it is open, so there is always a frame scheduled and `pumpAndSettle` waits
// until it times out. That is the animation doing its job, not a leak — every
// wait below is therefore an explicit pump of a known duration.

/// Pumps enough frames to carry a route transition through.
Future<void> _advance(WidgetTester tester,
    {int frames = 8, Duration step = const Duration(milliseconds: 100)}) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(step);
  }
}

Future<void> _open(WidgetTester tester, _Dispatcher dispatcher,
    {_StatusFeed? feed, ResidentVerification Function()? verification}) async {
  // Always a fake feed: the real one needs a Firebase app.
  final statusFeed = feed ?? _StatusFeed();
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: ElevatedButton(
              onPressed: () => showSosCountdown(
                context,
                dispatcher: dispatcher.call,
                statusStream: statusFeed.call,
                // Verified unless a test says otherwise: the lock has its own
                // tests below, and the rest are about the countdown.
                verification:
                    verification ?? () => ResidentVerification.verified,
              ),
              child: const Text('SOS'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('SOS'));
  await tester.pump(); // start the sheet's entrance
  await tester.pump(const Duration(milliseconds: 400)); // finish it
}

/// Presses the cancel control, holds for [duration], then releases.
///
/// Deliberately pumps nothing extra afterwards — several tests need to inspect
/// the countdown at a precise moment, and an over-eager settle would advance
/// the clock past it.
Future<void> _holdCancel(WidgetTester tester, Duration duration) async {
  final gesture =
      await tester.startGesture(tester.getCenter(find.text('Hold to cancel')));
  await tester.pump();
  await tester.pump(duration);
  await gesture.up();
  await tester.pump();
}

void main() {
  testWidgets('opens already counting — no second button to arm it',
      (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    expect(find.text('EMERGENCY ALERT'), findsOneWidget);
    // The clock is already running: 5 is on screen without any further input.
    expect(find.text('5'), findsOneWidget);
    expect(dispatcher.calls, 0);
  });

  testWidgets('counts 5 → 1 and dispatches at zero', (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    for (final second in [4, 3, 2, 1]) {
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('$second'), findsOneWidget,
          reason: 'expected the dial to read $second');
      expect(dispatcher.calls, 0, reason: 'must not fire early');
    }

    // The fifth second elapses and the alert goes out on its own.
    await tester.pump(const Duration(seconds: 1));
    await _advance(tester);

    expect(dispatcher.calls, 1);
    expect(find.text('SECURITY NOTIFIED'), findsOneWidget);
    // "en route" used to be here and was removed: a Firestore write landing
    // says a record exists, not that anyone has read it or left the
    // guardhouse. The sheet now states what it actually knows.
    expect(find.textContaining('en route'), findsNothing);
    expect(find.textContaining('has your alert'), findsOneWidget);
  });

  testWidgets('an offline alert reads as saved, never as sent', (tester) async {
    final dispatcher = _Dispatcher()..outcome = SosDispatchOutcome.queued;
    await _open(tester, dispatcher);

    await tester.pump(const Duration(seconds: 5));
    await _advance(tester);

    expect(dispatcher.calls, 1);
    // The whole point of the queued state: it must not claim the guardhouse
    // has the alert, and it must not read as a failure either.
    expect(find.text('SAVED — NO SIGNAL'), findsOneWidget);
    expect(find.text('SECURITY NOTIFIED'), findsNothing);
    expect(find.text('ALERT NOT SENT'), findsNothing);
    expect(find.textContaining('has not seen it yet'), findsOneWidget);
    expect(find.textContaining('send itself'), findsOneWidget);
  });

  testWidgets('a queued alert can be dismissed like a sent one', (tester) async {
    final dispatcher = _Dispatcher()..outcome = SosDispatchOutcome.queued;
    await _open(tester, dispatcher);

    await tester.pump(const Duration(seconds: 5));
    await _advance(tester);

    // No retry button: there is nothing to retry, the queue owns it now.
    expect(find.text('Done'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await _advance(tester);
    expect(find.text('SAVED — NO SIGNAL'), findsNothing);
  });

  testWidgets('a hold shorter than a second does NOT cancel', (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    // A brush, a knuckle, a pocket — the motions that must not abort a real
    // alert. The countdown has to survive them.
    await _holdCancel(tester, const Duration(milliseconds: 400));
    expect(find.text('EMERGENCY ALERT'), findsOneWidget);

    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(dispatcher.calls, 1, reason: 'the alert should still have gone out');
  });

  testWidgets('a full one-second hold cancels and sends nothing',
      (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    await _holdCancel(tester, const Duration(milliseconds: 1100));
    await _advance(tester);

    // Sheet gone…
    expect(find.text('EMERGENCY ALERT'), findsNothing);
    // …and no alert raised, now or later. The clock must be genuinely dead,
    // not merely hidden — this pump is what would catch a timer left running.
    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(dispatcher.calls, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the cancel control clears the 48px minimum touch height',
      (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    final button = tester.getSize(
      find
          .ancestor(
            of: find.text('Hold to cancel'),
            matching: find.byType(Container),
          )
          .first,
    );
    expect(button.height, greaterThanOrEqualTo(48));

    await _holdCancel(tester, const Duration(milliseconds: 1100));
    await _advance(tester);
  });

  testWidgets('a failed dispatch surfaces, and can be retried', (tester) async {
    final dispatcher = _Dispatcher()..shouldFail = true;
    await _open(tester, dispatcher);

    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);

    // A silent failure here is a resident who believes help is coming.
    expect(find.text('ALERT NOT SENT'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    dispatcher.shouldFail = false;
    await tester.tap(find.text('Try again'));
    await _advance(tester);

    expect(dispatcher.calls, 2);
    expect(find.text('SECURITY NOTIFIED'), findsOneWidget);
  });

  testWidgets('a back gesture cannot abort a running countdown',
      (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    // Stands in for the system back gesture.
    final NavigatorState navigator = tester.state(find.byType(Navigator));
    await navigator.maybePop();
    await _advance(tester, frames: 3);

    expect(find.text('EMERGENCY ALERT'), findsOneWidget,
        reason: 'back must not silently cancel an emergency');

    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(dispatcher.calls, 1);
  });

  testWidgets('the sheet closes normally once the alert has been sent',
      (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher);

    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(find.text('SECURITY NOTIFIED'), findsOneWidget);

    await tester.tap(find.text('Done'));
    await _advance(tester);

    expect(find.text('SECURITY NOTIFIED'), findsNothing);
    expect(dispatcher.calls, 1);
  });

  // ── THE LIVE TRACKER ──────────────────────────────────────────────────────

  Future<void> runOut(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
  }

  testWidgets('subscribes to the alert it raised, and waits honestly',
      (tester) async {
    final feed = _StatusFeed();
    await _open(tester, _Dispatcher(), feed: feed);
    await runOut(tester);

    expect(feed.watched, [_Dispatcher.alertId],
        reason: 'the sheet must follow the alert it just raised');
    expect(find.text('Received by the guardhouse'), findsOneWidget);
    expect(find.text('Waiting for an officer to acknowledge'), findsOneWidget);
    // Nothing about a responder until somebody has acknowledged.
    expect(find.text('Responder on the way'), findsNothing);
    await feed.close();
  });

  testWidgets('an acknowledgement names the officer who took it',
      (tester) async {
    final feed = _StatusFeed();
    await _open(tester, _Dispatcher(), feed: feed);
    await runOut(tester);

    feed.emit(SosAlertStatus(
      serverAcknowledged: true,
      respondedBy: 'Officer Dela Cruz',
      respondedAt: DateTime(2026, 8, 27, 21, 7),
    ));
    await _advance(tester, frames: 3);

    expect(find.text('Acknowledged by Officer Dela Cruz'), findsOneWidget);
    expect(find.text('Waiting for an officer to acknowledge'), findsNothing);
    expect(find.text('Responder on the way'), findsOneWidget);
    await feed.close();
  });

  testWidgets('an acknowledgement with no name still advances',
      (tester) async {
    final feed = _StatusFeed();
    await _open(tester, _Dispatcher(), feed: feed);
    await runOut(tester);

    feed.emit(SosAlertStatus(
      serverAcknowledged: true,
      respondedAt: DateTime(2026, 8, 27, 21, 7),
    ));
    await _advance(tester, frames: 3);

    expect(find.text('Acknowledged by an officer'), findsOneWidget);
    await feed.close();
  });

  testWidgets('a resolved alert closes the tracker out', (tester) async {
    final feed = _StatusFeed();
    await _open(tester, _Dispatcher(), feed: feed);
    await runOut(tester);

    feed.emit(SosAlertStatus(
      serverAcknowledged: true,
      respondedBy: 'Officer Dela Cruz',
      respondedAt: DateTime(2026, 8, 27, 21, 7),
      resolvedAt: DateTime(2026, 8, 27, 21, 20),
    ));
    await _advance(tester, frames: 3);

    expect(find.text('Marked resolved'), findsOneWidget);
    expect(find.text('Responder on the way'), findsNothing);
    await feed.close();
  });

  testWidgets('a queued alert waits for signal, then turns sent when it lands',
      (tester) async {
    final feed = _StatusFeed();
    await _open(tester, _Dispatcher()..outcome = SosDispatchOutcome.queued,
        feed: feed);
    await runOut(tester);

    expect(find.text('SAVED — NO SIGNAL'), findsOneWidget);
    expect(find.text('Waiting for signal'), findsOneWidget);
    expect(find.text('Received by the guardhouse'), findsNothing);

    // Still only in this phone's cache: not delivered, nothing changes.
    feed.emit(const SosAlertStatus(serverAcknowledged: false));
    await _advance(tester, frames: 3);
    expect(find.text('SAVED — NO SIGNAL'), findsOneWidget);

    // The sync service lands it while the sheet is still open.
    feed.emit(const SosAlertStatus(serverAcknowledged: true));
    await _advance(tester, frames: 3);
    expect(find.text('SECURITY NOTIFIED'), findsOneWidget);
    expect(find.text('SAVED — NO SIGNAL'), findsNothing);
    expect(find.text('Received by the guardhouse'), findsOneWidget);
    await feed.close();
  });

  testWidgets('a feed that errors leaves the sheet standing', (tester) async {
    final feed = _StatusFeed();
    await _open(tester, _Dispatcher(), feed: feed);
    await runOut(tester);

    feed._controller.addError(StateError('permission-denied'));
    await _advance(tester, frames: 3);

    expect(tester.takeException(), isNull);
    expect(find.text('SECURITY NOTIFIED'), findsOneWidget);
    await feed.close();
  });

  testWidgets('a feed that ends is asked again, and the queued alert lands',
      (tester) async {
    // A fresh stream per subscription: the first is refused and closes (the
    // rules deny a listen on a document that does not exist yet); the second
    // arrives once the alert has landed.
    final streams = <StreamController<SosAlertStatus>>[];
    Stream<SosAlertStatus> feed(String _) {
      final c = StreamController<SosAlertStatus>();
      streams.add(c);
      return c.stream;
    }

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => showSosCountdown(
              context,
              dispatcher: (_Dispatcher()..outcome = SosDispatchOutcome.queued)
                  .call,
              statusStream: feed,
            ),
            child: const Text('SOS'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('SOS'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(streams, hasLength(1));
    expect(find.text('SAVED — NO SIGNAL'), findsOneWidget);

    await streams.first.close();
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));
    expect(streams, hasLength(2), reason: 'a closed feed must be retried');

    streams.last.add(const SosAlertStatus(serverAcknowledged: true));
    await _advance(tester, frames: 3);
    expect(find.text('SECURITY NOTIFIED'), findsOneWidget);

    for (final c in streams) {
      await c.close();
    }
  });

  // ── LOCKED FOR AN UNVERIFIED ACCOUNT ─────────────────────────────────────

  testWidgets('a pending account gets the locked sheet, and nothing is sent',
      (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher,
        verification: () => ResidentVerification.pending);

    expect(find.text('SOS UNAVAILABLE'), findsOneWidget);
    expect(find.text('Verification Pending'), findsOneWidget);
    expect(find.textContaining('under review'), findsOneWidget);
    expect(find.textContaining('Call main gate'), findsOneWidget);
    // No countdown, no cancel control.
    expect(find.text('EMERGENCY ALERT'), findsNothing);
    expect(find.text('Hold to cancel'), findsNothing);

    // Long past when the alert would have fired.
    await tester.pump(const Duration(seconds: 8));
    await _advance(tester);
    expect(dispatcher.calls, 0);

    await tester.tap(find.text('Close'));
    await _advance(tester);
    expect(find.text('SOS UNAVAILABLE'), findsNothing);
  });

  testWidgets('a rejected account is told it was not approved',
      (tester) async {
    await _open(tester, _Dispatcher(),
        verification: () => ResidentVerification.rejected);

    expect(find.text('Account Not Approved'), findsOneWidget);
    expect(find.textContaining('did not approve'), findsOneWidget);
  });

  testWidgets('an unknown standing does not lock', (tester) async {
    final dispatcher = _Dispatcher();
    await _open(tester, dispatcher,
        verification: () => ResidentVerification.unknown);

    expect(find.text('EMERGENCY ALERT'), findsOneWidget);
    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(dispatcher.calls, 1,
        reason: 'a check that could not be made is not "not verified"');
  });

  testWidgets('a pending status that lands mid-countdown stops the alert',
      (tester) async {
    final dispatcher = _Dispatcher();
    var standing = ResidentVerification.unknown;
    await _open(tester, dispatcher, verification: () => standing);

    await tester.pump(const Duration(seconds: 2));
    expect(find.text('EMERGENCY ALERT'), findsOneWidget);

    standing = ResidentVerification.pending;
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
    expect(find.text('SOS UNAVAILABLE'), findsOneWidget);

    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);
    expect(dispatcher.calls, 0);
  });

  testWidgets('a dispatch the server refuses opens the locked sheet',
      (tester) async {
    // The standing was unknown, so the app could not lock up front; the
    // server then refused the alert. It must never read as queued.
    final feed = _StatusFeed();
    final dispatcher = _Dispatcher()..outcome = SosDispatchOutcome.refused;
    await _open(tester, dispatcher,
        feed: feed, verification: () => ResidentVerification.unknown);
    await tester.pump(const Duration(seconds: 6));
    await _advance(tester);

    expect(dispatcher.calls, 1);
    expect(find.text('SOS UNAVAILABLE'), findsOneWidget);
    expect(find.text('Verification Pending'), findsOneWidget);
    expect(find.text('SAVED — NO SIGNAL'), findsNothing);
    expect(find.textContaining('send itself'), findsNothing);
    expect(feed.watched, isEmpty,
        reason: 'a refused alert has no document to follow');
    await feed.close();
  });
}
