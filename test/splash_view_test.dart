import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/brand/brand_mark.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/onboarding/widgets/splash_view.dart';

/// The splash under a chosen DEVICE appearance.
///
/// The brightness goes in through [MediaQueryData.platformBrightness] and not
/// through a [Theme], which is the whole point of these tests: the app pins
/// `themeMode: ThemeMode.light` and puts the same light [ThemeData] in both
/// theme slots, so a splash that branched on `Theme.of(context).brightness`
/// could never render its dark state on any device. These tests fail if that
/// regression comes back.
Widget _harness(Brightness platform, {bool animateIn = true}) {
  return MediaQuery(
    data: MediaQueryData(platformBrightness: platform),
    child: Directionality(
      textDirection: TextDirection.ltr,
      child: SplashView(animateIn: animateIn),
    ),
  );
}

Color _canvasOf(WidgetTester tester) {
  final box = tester.widget<ColoredBox>(
    find.descendant(
      of: find.byType(SplashCanvas),
      matching: find.byType(ColoredBox),
    ),
  );
  return box.color;
}

Color _inkOf(WidgetTester tester) =>
    tester.widget<BrandMark>(find.byType(BrandMark)).color;

void main() {
  group('SplashPalette', () {
    test('is one palette — white canvas, emerald mark, on every device', () {
      // This class used to resolve from the OS appearance and carry a dark
      // variant (#09090B with the portals' creamy #FFFDD7 mark). The dark
      // branch was removed by request, so there is nothing to resolve: the
      // splash is white with the emerald mark whatever the system is set to.
      expect(SplashPalette.canvas, const Color(0xFFFFFFFF));
      expect(SplashPalette.ink, AppColors.brandMarkOnLight);
      expect(SplashPalette.ink, const Color(0xFF047857));
    });

    test('system bars are matched to the white canvas', () {
      // `main()` sets a GLOBAL overlay style with LIGHT status-bar icons,
      // which paints white glyphs onto this white canvas. The AnnotatedRegion
      // in SplashCanvas overrides it while the splash is on top — which is
      // why this class survived the simplification instead of collapsing
      // into two bare colour constants.
      const style = SplashPalette.overlayStyle;
      expect(style.statusBarIconBrightness, Brightness.dark);
      expect(style.systemNavigationBarIconBrightness, Brightness.dark);
      expect(style.systemNavigationBarColor, SplashPalette.canvas);
    });
  });

  group('SplashView', () {
    testWidgets('shows the emblem and nothing else', (tester) async {
      await tester.pumpWidget(_harness(Brightness.light));
      await tester.pumpAndSettle();

      expect(find.byType(BrandMark), findsOneWidget);
      // No wordmark, no tagline, no loading copy, no version number.
      expect(find.byType(Text), findsNothing);
    });

    testWidgets('renders the same whatever the device appearance is set to',
        (tester) async {
      // The inverse of the test this replaces. That one asserted the splash
      // FOLLOWED `platformBrightness`; this one asserts it no longer does,
      // which is the thing a future reader is most likely to "fix" back.
      await tester.pumpWidget(_harness(Brightness.light));
      await tester.pumpAndSettle();
      expect(_canvasOf(tester), SplashPalette.canvas);
      expect(_inkOf(tester), SplashPalette.ink);

      await tester.pumpWidget(_harness(Brightness.dark));
      await tester.pumpAndSettle();
      expect(_canvasOf(tester), SplashPalette.canvas);
      expect(_inkOf(tester), SplashPalette.ink);
      expect(_canvasOf(tester), isNot(const Color(0xFF09090B)));
      expect(_inkOf(tester), isNot(AppColors.brandMarkOnDark));
    });

    testWidgets('centres the emblem on both axes', (tester) async {
      await tester.pumpWidget(_harness(Brightness.light));
      await tester.pumpAndSettle();

      final screen = tester.getRect(find.byType(SplashCanvas));
      final mark = tester.getRect(find.byType(BrandMark));
      expect(mark.center.dx, moreOrLessEquals(screen.center.dx, epsilon: 0.01));
      expect(mark.center.dy, moreOrLessEquals(screen.center.dy, epsilon: 0.01));

      // Full-bleed: the canvas is the viewport, not an inset safe area.
      expect(screen, tester.getRect(find.byType(SplashView)));
    });

    testWidgets('the canvas covers the whole viewport', (tester) async {
      await tester.pumpWidget(_harness(Brightness.dark));
      await tester.pumpAndSettle();

      final canvas = tester.getRect(
        find.descendant(
          of: find.byType(SplashCanvas),
          matching: find.byType(ColoredBox),
        ),
      );
      expect(canvas.topLeft, Offset.zero);
      expect(canvas.size, tester.view.physicalSize / tester.view.devicePixelRatio);
    });

    testWidgets('animates in by default and settles fully opaque',
        (tester) async {
      await tester.pumpWidget(_harness(Brightness.light));
      await tester.pump();

      final entrance = tester.widget<FadeTransition>(
        find.byType(FadeTransition),
      );
      expect(entrance.opacity.value, lessThan(0.25));

      await tester.pumpAndSettle();
      expect(entrance.opacity.value, 1.0);
    });

    testWidgets('animateIn: false shows the emblem with no entrance at all',
        (tester) async {
      // AuthGate's start-up wait rebuilds through several phases. Replaying the
      // entrance on each one would pulse the logo repeatedly.
      await tester.pumpWidget(_harness(Brightness.light, animateIn: false));
      await tester.pump();

      expect(find.byType(FadeTransition), findsNothing);
      expect(find.byType(ScaleTransition), findsNothing);
      expect(find.byType(BrandMark), findsOneWidget);
    });

    testWidgets('publishes the one overlay style', (tester) async {
      await tester.pumpWidget(_harness(Brightness.dark));
      await tester.pumpAndSettle();

      final region = tester.widget<AnnotatedRegion<SystemUiOverlayStyle>>(
        find.byType(AnnotatedRegion<SystemUiOverlayStyle>),
      );
      // Dark glyphs even on a device set to dark, because the canvas under
      // them is white either way.
      expect(region.value.statusBarIconBrightness, Brightness.dark);
      expect(region.value.systemNavigationBarColor, SplashPalette.canvas);
    });

  });

  group('BrandMark', () {
    test('sizes from height at the artwork ratio, never square', () {
      expect(BrandMark.artworkSize, const Size(192, 179));
      expect(BrandMark.widthFor(179), moreOrLessEquals(192, epsilon: 0.01));
      // Wider than it is tall — a square box would letterbox the mark and
      // render it smaller than the height asked for.
      expect(BrandMark.widthFor(100), greaterThan(100));
    });

    testWidgets('lays out at the ratio its caller asked for', (tester) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: Center(
            child: BrandMark(height: 104, color: Color(0xFF047857)),
          ),
        ),
      );

      final rect = tester.getRect(find.byType(BrandMark));
      expect(rect.height, 104);
      expect(rect.width, moreOrLessEquals(BrandMark.widthFor(104), epsilon: 0.01));
    });

    testWidgets('is content, not decoration, when it stands alone',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_harness(Brightness.light));
      await tester.pumpAndSettle();

      // The splash has no wordmark beside the emblem, so the emblem has to
      // carry the brand name for a screen reader.
      expect(find.bySemanticsLabel('Monticello Villas'), findsOneWidget);
      handle.dispose();
    });
  });

  group('parseSvgPathData', () {
    test('handles absolute M/L/C/Z, implicit linetos and exponents', () {
      // The implicit lineto after the moveto, and Figma's exponent notation
      // for near-zero coordinates (`6.86646e-05`), both appear verbatim in the
      // exported artwork.
      final path = parseSvgPathData('M6.86646e-05 0L10 0L10 20L0 20Z');
      final bounds = path.getBounds();
      expect(bounds.left, moreOrLessEquals(0, epsilon: 0.001));
      expect(bounds.right, moreOrLessEquals(10, epsilon: 0.001));
      expect(bounds.bottom, moreOrLessEquals(20, epsilon: 0.001));
      expect(path.contains(const Offset(5, 10)), isTrue);
    });

    test('curves land on their end point', () {
      final path = parseSvgPathData('M0 0C5 0 10 5 10 10Z');
      expect(path.getBounds().right, moreOrLessEquals(10, epsilon: 0.001));
    });

    test('throws rather than mis-drawing an unsupported command', () {
      // Relative commands and arcs would both silently produce a wrong mark.
      expect(() => parseSvgPathData('m0 0l10 10'), throwsFormatException);
      expect(
        () => parseSvgPathData('M0 0A5 5 0 0 1 10 10'),
        throwsFormatException,
      );
    });
  });
}
