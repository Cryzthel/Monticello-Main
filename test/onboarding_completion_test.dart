import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/onboarding/screens/onboarding_screen.dart';

/// Guards the "Get Started" button against the storage layer.
///
/// The regression: leaving onboarding was made conditional on a
/// SharedPreferences round-trip. `markSeen()` swallows every exception and
/// `hasSeen()` returns false on error, so when the plugin is unavailable the
/// flag never flips, the router rebuilds onboarding, and the button appears
/// completely dead — silently, with nothing logged.
///
/// These tests run with the SharedPreferences platform channel deliberately
/// BROKEN, which is the exact condition that produced the loop.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Every SharedPreferences call throws. Persistence is impossible.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/shared_preferences'),
      (call) async => throw PlatformException(code: 'unavailable'),
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/shared_preferences'),
      null,
    );
  });

  testWidgets('onCompleted still fires when persistence is unavailable',
      (tester) async {
    var completed = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: OnboardingScreen(onCompleted: () => completed++),
      ),
    );
    await tester.pumpAndSettle();

    // Walk to the final slide, then leave.
    for (var i = 0; i < 4 && completed == 0; i++) {
      final getStarted = find.text('Get Started');
      final cont = find.text('Continue');
      if (getStarted.evaluate().isNotEmpty) {
        await tester.tap(getStarted);
      } else if (cont.evaluate().isNotEmpty) {
        await tester.tap(cont);
      } else {
        break;
      }
      await tester.pumpAndSettle();
    }

    // The whole point: a dead storage layer must not trap the user here.
    expect(
      completed,
      1,
      reason: 'Get Started must advance even when SharedPreferences throws',
    );
  });

  test('hasSeen reports false rather than throwing when storage is broken',
      () async {
    // Documents the swallow-and-return-false behaviour the router must not
    // treat as authoritative for the current session.
    expect(await OnboardingScreen.hasSeen(), isFalse);
  });

  test('markSeen does not throw when storage is broken', () async {
    expect(OnboardingScreen.markSeen(), completes);
  });
}
