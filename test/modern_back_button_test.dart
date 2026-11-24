import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';

/// Guards the dead-back-button regression.
///
/// History is rendered as a TAB inside the home shell, not pushed onto the
/// navigator, so `Navigator.canPop()` is false there. The button used to read
/// `if (canPop()) pop();` — which meant it animated under the finger and then
/// did nothing at all. Every test below exists to keep a tap from going
/// unanswered.
void main() {
  testWidgets('pops when there is a route to pop', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const Scaffold(
                    body: Center(child: ModernBackButton()),
                  ),
                ),
              ),
              child: const Text('push'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('push'));
    await tester.pumpAndSettle();
    expect(find.byType(ModernBackButton), findsOneWidget);

    await tester.tap(find.byType(ModernBackButton));
    await tester.pumpAndSettle();

    expect(find.text('push'), findsOneWidget);
    expect(find.byType(ModernBackButton), findsNothing);
  });

  testWidgets('calls onNothingToPop when it is a tab, not a route',
      (tester) async {
    var wentBack = 0;

    await tester.pumpWidget(
      MaterialApp(
        // No pushed route — exactly the History-as-a-tab situation.
        home: Scaffold(
          body: Center(
            child: ModernBackButton(onNothingToPop: () => wentBack++),
          ),
        ),
      ),
    );

    await tester.tap(find.byType(ModernBackButton));
    await tester.pumpAndSettle();

    expect(wentBack, 1);
  });

  testWidgets('falls back to Home when nothing else answers', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        routes: {
          '/': (_) => const Scaffold(body: Center(child: ModernBackButton())),
          '/home': (_) => const Scaffold(body: Center(child: Text('HOME'))),
        },
      ),
    );

    await tester.tap(find.byType(ModernBackButton));
    await tester.pumpAndSettle();

    // The tap is answered rather than swallowed — the whole point of the fix.
    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('onPressed still overrides everything', (tester) async {
    var custom = 0;
    var fallback = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: ModernBackButton(
              onPressed: () => custom++,
              onNothingToPop: () => fallback++,
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.byType(ModernBackButton));
    await tester.pumpAndSettle();

    expect(custom, 1);
    expect(fallback, 0, reason: 'onPressed wins outright');
  });

  testWidgets('the tap target is at least 44x44 even though the art is 40',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: Center(child: ModernBackButton())),
      ),
    );

    final size = tester.getSize(find.byType(ModernBackButton));
    expect(size.width, greaterThanOrEqualTo(ModernBackButton.minTouchTarget));
    expect(size.height, greaterThanOrEqualTo(ModernBackButton.minTouchTarget));
  });

  testWidgets('a tap in the padding ring still registers', (tester) async {
    var wentBack = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: ModernBackButton(onNothingToPop: () => wentBack++),
          ),
        ),
      ),
    );

    // 21px out from centre lands outside the 40px circle (radius 20) but
    // inside the 44px target. This is the strip the fix bought.
    final centre = tester.getCenter(find.byType(ModernBackButton));
    await tester.tapAt(centre + const Offset(21, 21));
    await tester.pumpAndSettle();

    expect(wentBack, 1);
  });
}
