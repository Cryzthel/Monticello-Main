import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// Guards the app's typography against a network-dependent font.
///
/// Nothing in this project bundles Urbanist — `GoogleFonts.urbanist()` fetches
/// it from fonts.gstatic.com at runtime. On an offline or throttled device the
/// family never registers, and a TextStyle that names ONLY that family gives
/// the engine no metrics to lay out against: panels and borders still paint,
/// but their text renders as nothing. That is what produced a screen showing
/// only an empty glass card on the dark canvas.
///
/// Note the font load fails ACROSS AN ASYNCHRONOUS GAP, so a try/catch around
/// `GoogleFonts.urbanist()` cannot intercept it. The only thing that actually
/// keeps text legible is naming a fallback family that is guaranteed present,
/// which is what these tests pin down.
void main() {
  setUpAll(() {
    // Force the production failure mode: no bundled asset and no fetching, so
    // this is exactly the state a disconnected phone is in.
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  /// Drains the expected "could not load Urbanist" async error so it doesn't
  /// fail the test. Its ABSENCE would be the surprise — it is the very
  /// condition being guarded against.
  void drainFontLoadError(WidgetTester tester) {
    final error = tester.takeException();
    if (error != null) {
      expect(error.toString(), contains('Urbanist'));
    }
  }

  testWidgets('sfPro always names a resolvable fallback family',
      (tester) async {
    final style = sfPro(fontSize: 14, fontWeight: FontWeight.w700);

    expect(style.fontFamilyFallback, isNotNull);
    expect(style.fontFamilyFallback, isNotEmpty);
    expect(style.fontFamilyFallback, contains('sans-serif'));
    drainFontLoadError(tester);
  });

  testWidgets('sfPro carries through the caller’s own properties',
      (tester) async {
    const color = Color(0xFF63E6BE);
    final style = sfPro(fontSize: 21, fontWeight: FontWeight.w700, color: color);

    expect(style.fontSize, 21);
    expect(style.fontWeight, FontWeight.w700);
    expect(style.color, color);
    drainFontLoadError(tester);
  });

  testWidgets('the Material text theme carries the same fallback',
      (tester) async {
    final theme = AppTheme.darkTheme;

    expect(theme.textTheme.bodyMedium?.fontFamilyFallback, contains('sans-serif'));
    expect(theme.textTheme.titleLarge?.fontFamilyFallback, contains('sans-serif'));
    drainFontLoadError(tester);
  });

  testWidgets('text laid out with sfPro occupies real space', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: Text(
              'Account Pending Verification',
              style: sfPro(fontSize: 21, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ),
    );

    // The regression signature was text collapsing to nothing inside an
    // otherwise correctly-sized card.
    final size = tester.getSize(find.byType(Text));
    expect(size.width, greaterThan(0));
    expect(size.height, greaterThan(0));
    drainFontLoadError(tester);
  });
}
