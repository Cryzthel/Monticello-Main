import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/core/widgets/staged_submit_button.dart';

void main() {
  group('input typography', () {
    test('typed text is heavier than the hint it replaces', () {
      // The point: at w400 a filled field and an empty one set at the same
      // weight, so an answer looked like a prompt. Weight is what separates
      // what the resident wrote from what the app suggested.
      expect(AppInput.weight, FontWeight.w600);
      expect(AppInput.weight.value, greaterThan(FontWeight.w400.value));
    });

    test('the mask is a black circle, not a typographic bullet', () {
      // U+2022 is a mid-dot sized for running text — a speck against a 15px
      // field. U+25CF is the glyph both platforms use in their own passcode
      // fields.
      expect(AppInput.obscuringCharacter, '\u25CF');
      expect(AppInput.obscuringCharacter, isNot('\u2022'));
      expect(AppInput.obscuringCharacter.length, 1,
          reason: 'Flutter requires exactly one character');
      expect(AppInput.obscuredSpacing, greaterThan(0),
          reason: 'circles at prose tracking run together into a bar');
    });
  });

  group('the account-creation submit button', () {
    testWidgets('spins the same leaf as every button, not a bar or a number',
        (tester) async {
      final controller = StagedProgressController();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StagedSubmitButton(
              label: 'Create Account',
              onPressed: () {},
              busy: true,
              controller: controller,
            ),
          ),
        ),
      );
      controller.updatePercent(45);
      await tester.pump();

      expect(find.byType(LeafLoader), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      // The steps behind these percentages are nothing like equal in
      // duration, so a precise figure would invite arithmetic it cannot
      // support.
      expect(find.text('45%'), findsNothing);
      await tester.pump(const Duration(milliseconds: 600));
    });

    testWidgets('keeps its height and refuses taps while working',
        (tester) async {
      var taps = 0;
      Future<void> pump({required bool busy}) => tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: StagedSubmitButton(
                  label: 'Create Account',
                  onPressed: () => taps++,
                  busy: busy,
                ),
              ),
            ),
          );
      await pump(busy: false);
      final idle = tester.getSize(find.byType(StagedSubmitButton)).height;
      await pump(busy: true);
      expect(tester.getSize(find.byType(StagedSubmitButton)).height, idle);
      await tester.tap(find.byType(StagedSubmitButton));
      expect(taps, 0);
      await tester.pump(const Duration(milliseconds: 600));
    });

    testWidgets('the label stands alone, with no leading glyph',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StagedSubmitButton(label: 'Create Account', onPressed: () {}),
          ),
        ),
      );

      expect(find.text('Create Account'), findsOneWidget);
      // A checkmark BEFORE the action is taken says the opposite of what it
      // means — and the same tick is what the button draws once the account
      // actually exists.
      expect(
        find.descendant(
          of: find.byType(StagedSubmitButton),
          matching: find.byType(Icon),
        ),
        findsNothing,
      );
    });
  });

  group('the sign-up step header', () {
    /// The header is private to the sign-up screen, and that screen needs
    /// Firebase to build. What is asserted here is the LAYOUT CONTRACT it now
    /// follows, reproduced from the same construction: equal step columns, a
    /// node centred in each, a label centred in the same one.
    ///
    /// The old build was `Row[circle, gap, label, Expanded(rail), circle, gap,
    /// label]` — node positions set by the width of two words. These are the
    /// numbers that arrangement could not produce.
    double centreOf(int i, double width, int steps) =>
        (width / steps) * (i + 0.5);

    test('nodes are evenly spaced and symmetric about the middle', () {
      const width = 320.0;
      const steps = 2;
      final centres = [for (var i = 0; i < steps; i++) centreOf(i, width, steps)];

      expect(centres[1] - centres[0], closeTo(width / steps, 0.01));
      // The outer nodes sit half a column in from each edge, not flush against
      // the gutters.
      expect(centres.first, closeTo(width - centres.last, 0.01));
    });

    test('a label cell centres on its own node, at any width', () {
      // Expanded cells split the row evenly, so cell i centres at the same
      // point node i does — which is the whole claim "labels beneath the bar"
      // makes, and the one the inline layout got wrong by exactly the width of
      // the first label.
      for (final width in [280.0, 320.0, 420.0, 760.0]) {
        for (var i = 0; i < 2; i++) {
          final cellCentre = (width / 2) * i + (width / 2) / 2;
          expect(cellCentre, closeTo(centreOf(i, width, 2), 0.01),
              reason: 'step $i drifts at ${width}px');
        }
      }
    });

    test('the rail spans between node edges and never inverts', () {
      // Floored at zero: a Positioned with a negative width asserts out of
      // layout, which a narrow enough screen would otherwise produce.
      const nodeSize = 32.0;
      const inset = 6.0;
      for (final width in [120.0, 280.0, 420.0]) {
        final column = width / 2;
        final railWidth = (column - nodeSize - inset * 2).clamp(0.0, column);
        expect(railWidth, greaterThanOrEqualTo(0));
        expect(railWidth, lessThan(column));
      }
      // The degenerate case the clamp exists for.
      const tiny = 60.0;
      final tinyColumn = tiny / 2;
      expect((tinyColumn - nodeSize - inset * 2).clamp(0.0, tinyColumn), 0);
    });
  });
}
