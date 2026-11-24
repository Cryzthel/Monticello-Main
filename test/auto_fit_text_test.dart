import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/auto_fit_text.dart';

/// Guards the dashboard header's promise that a resident's FULL name is on it.
///
/// The header identifies a person. It is what the HOA office verified and what
/// a guard matches an incident report to, and for a release it rendered at
/// `maxLines: 1` with `TextOverflow.ellipsis` in a box roughly 190dp wide —
/// so every resident with a compound surname was greeted by half of their own
/// name and three dots.
///
/// These assert the BEHAVIOUR, not the numbers: that the type shrinks rather
/// than clipping, that it only shrinks when it has to, and that it stops
/// somewhere rather than vanishing. Pinning "a 24-character name comes out at
/// 17.5px" would fail on the next font-metric change without anything actually
/// being wrong.
const double _requested = 20;

/// A name that does not fit on one line at 20px in the widths used below, and
/// is entirely ordinary on this estate's resident list.
///
/// Deliberately free of hyphens. `flutter_test` swaps in a font whose every
/// glyph is a square of the font size, which is what makes the widths below
/// predictable — but where a line may BREAK is still the text engine's call,
/// and a hyphenated surname is exactly the case where that stops being
/// obvious. The behaviour under test has nothing to do with hyphens.
const String _longName = 'Cristina Villanueva';

/// [minFontSize] defaults far below anything the app passes, so the tests that
/// are about SHRINKING never accidentally end up testing the floor instead.
/// The two that are about the floor set it themselves.
Future<Text> _pump(
  WidgetTester tester, {
  required String data,
  required double width,
  int maxLines = 2,
  double minFontSize = 6,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: width,
            child: AutoFitText(
              data: data,
              maxLines: maxLines,
              minFontSize: minFontSize,
              semanticsLabel: data,
              style: const TextStyle(
                fontSize: _requested,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ),
    ),
  );
  return tester.widget<Text>(find.byType(Text));
}

double _size(Text t) => t.style!.fontSize!;

void main() {
  group('it only shrinks when it has to', () {
    testWidgets('a short name keeps the size it was asked for', (tester) async {
      final text = await _pump(tester, data: 'Ana Cruz', width: 300);

      expect(_size(text), _requested);
    });

    testWidgets('a long name wraps to two lines before it shrinks',
        (tester) async {
      // Wide enough for the name across two lines at full size. Wrapping is
      // free — it costs the header ~24px of height — so it has to be spent
      // before any type size is given up.
      final text = await _pump(tester, data: _longName, width: 230);

      expect(_size(text), _requested);
      expect(find.text(_longName), findsOneWidget);
    });
  });

  group('it shrinks rather than clipping', () {
    testWidgets('a long name in a narrow box comes back smaller, not cut',
        (tester) async {
      final text = await _pump(tester, data: _longName, width: 120);

      // THE POINT OF THIS FILE. Smaller type, whole name.
      expect(_size(text), lessThan(_requested));
      expect(text.overflow, isNot(TextOverflow.ellipsis));
      expect(text.data, _longName);
    });

    testWidgets('the narrower the box, the smaller the type', (tester) async {
      final roomy = await _pump(tester, data: _longName, width: 160);
      final tight = await _pump(tester, data: _longName, width: 100);

      expect(_size(tight), lessThan(_size(roomy)));
    });

    testWidgets('one line shrinks harder than two, for the same string',
        (tester) async {
      // A page title cannot wrap — the bar is a fixed 44px and the back button
      // is centred against it — so PageTitleBar passes maxLines: 1 and pays
      // for it in type size. Same string, same box, different budget.
      final oneLine = await _pump(
          tester, data: _longName, width: 200, maxLines: 1, minFontSize: 4);
      final twoLines = await _pump(
          tester, data: _longName, width: 200, maxLines: 2, minFontSize: 4);

      expect(_size(oneLine), lessThan(_size(twoLines)));
    });
  });

  group('the floor', () {
    testWidgets('it stops shrinking, and clips only there', (tester) async {
      // A box this narrow cannot hold the string at any size the header would
      // still be a header at. The floor is what stops the search walking the
      // type down to nothing, and an ellipsis at the floor is the correct
      // last resort — painting past the box would be worse than clipping.
      final text = await _pump(
          tester, data: _longName, width: 40, minFontSize: 15, maxLines: 1);

      expect(_size(text), 15);
      expect(text.overflow, TextOverflow.ellipsis);
    });

    testWidgets('is never crossed on the way down', (tester) async {
      for (final width in const [200.0, 160.0, 120.0, 90.0, 60.0]) {
        final text = await _pump(
            tester, data: _longName, width: width, minFontSize: 15);
        expect(_size(text), greaterThanOrEqualTo(15),
            reason: 'at width $width');
      }
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader is given the whole string at any size',
        (tester) async {
      // Whatever the search settles on is a VISUAL decision. It must not reach
      // the semantics tree, or a resident using TalkBack would hear a name
      // that had been sized to fit a box they cannot see.
      final text = await _pump(tester, data: _longName, width: 110);

      expect(_size(text), lessThan(_requested));
      expect(text.semanticsLabel, _longName);
    });
  });

  group('degenerate boxes', () {
    testWidgets('an unbounded width renders at full size without searching',
        (tester) async {
      // Inside a Row or a scroll view on the cross axis there is no maxWidth to
      // fit to, and the scan would walk to the floor measuring against
      // infinity. Nothing can overflow horizontally there, so it renders as
      // asked.
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Row(
              children: [
                AutoFitText(
                  data: _longName,
                  style: TextStyle(fontSize: _requested),
                ),
              ],
            ),
          ),
        ),
      );

      expect(_size(tester.widget<Text>(find.byType(Text))), _requested);
      expect(tester.takeException(), isNull);
    });
  });
}
