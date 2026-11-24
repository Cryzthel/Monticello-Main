import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/features/incidents/widgets/location_selector_panel.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';

/// The report form's "Where is the incident?" section: ONE searchable
/// Phase / Block / Lot field over the estate's real schedule.
void main() {
  late List<SubdivisionAddress?> reported;

  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<void> pumpCard(WidgetTester tester, {String? errorText}) async {
    reported = [];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: LocationEntryCard(
                address: null,
                onAddressChanged: reported.add,
                errorText: errorText,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Finder field() => find.byType(TextField);

  Future<void> type(WidgetTester tester, String query) async {
    await tester.tap(field());
    await tester.pumpAndSettle();
    await tester.enterText(field(), query);
    await tester.pumpAndSettle();
  }

  group('layout', () {
    testWidgets('one search field — no street/landmark box', (tester) async {
      await pumpCard(tester);
      expect(field(), findsOneWidget);
      expect(find.text('Enter your phase, block or lot…'), findsOneWidget);
      expect(find.text('Street, landmark or gate'), findsNothing);
    });

    testWidgets('the text is set large enough to read', (tester) async {
      await pumpCard(tester);
      final input = tester.widget<TextField>(field());
      expect(input.style!.fontSize, greaterThanOrEqualTo(15));
      expect(input.decoration!.hintStyle!.fontSize, greaterThanOrEqualTo(15));
    });

    testWidgets('its label sits above the box, like Incident details',
        (tester) async {
      await pumpCard(tester);
      expect(find.text('Where is the incident?'), findsNothing);
      final deco = tester.widget<TextField>(field()).decoration!;
      // Outside the field, not floating inside it (2026-10-19)…
      expect(deco.labelText, isNull);
      final label = find.text('Phase, Block & Lot');
      expect(label, findsOneWidget);
      expect(tester.getBottomLeft(label).dy,
          lessThanOrEqualTo(tester.getTopLeft(field()).dy));
      // …so the placeholder shows at rest, before the field is tapped.
      expect(find.text('Enter your phase, block or lot…'), findsOneWidget);

      // The description field renders through the very same widget, so the
      // two share size, padding, border and label behaviour by construction.
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: AddressInput(
            controller: TextEditingController(),
            hint: 'Describe what happened',
            label: 'Incident details',
            maxLines: 4,
          ),
        ),
      ));
      final details = tester.widget<TextField>(field()).decoration!;
      expect(details.labelText, isNull);
      expect(find.text('Incident details'), findsOneWidget);
      expect(details.hintStyle, deco.hintStyle);
      expect(details.enabledBorder, deco.enabledBorder);
      expect(details.focusedBorder, deco.focusedBorder);
    });
  });

  group('searching', () {
    testWidgets('bare numbers find the lot, and picking it reports it',
        (tester) async {
      await pumpCard(tester);
      await type(tester, '1 4 12');
      expect(find.text('Phase 1, Block 4, Lot 12'), findsWidgets);

      await tester.tap(find.text('Phase 1, Block 4, Lot 12').last);
      await tester.pumpAndSettle();
      expect(reported.last,
          const SubdivisionAddress(phase: '1', block: 4, lot: 12));
    });

    testWidgets('a labelled token filters live', (tester) async {
      await pumpCard(tester);
      await type(tester, 'blk 2');
      expect(find.text('Phase 1, Block 2, Lot 1'), findsOneWidget);
    });

    testWidgets('a lot inside a gap matches nothing, and says so',
        (tester) async {
      // Phase 1 Block 3 starts at Lot 25.
      await pumpCard(tester);
      await type(tester, 'phase 1 block 3 lot 5');
      expect(find.text('No lot matches that'), findsOneWidget);
    });
  });

  group('the keyboard', () {
    testWidgets('the Search key drops the keyboard and takes the top match',
        (tester) async {
      await pumpCard(tester);
      await type(tester, '1 4 12');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();

      expect(tester.testTextInput.isVisible, isFalse);
      expect(reported.last,
          const SubdivisionAddress(phase: '1', block: 4, lot: 12));
    });

    testWidgets('scrolling the suggestions keeps the keyboard and the query',
        (tester) async {
      await pumpCard(tester);
      await type(tester, 'blk 2');
      expect(tester.testTextInput.isVisible, isTrue);

      await tester.drag(
          find.text('Phase 1, Block 2, Lot 1'), const Offset(0, -120));
      await tester.pumpAndSettle();

      expect(tester.testTextInput.isVisible, isTrue);
      expect(tester.widget<TextField>(field()).controller!.text, 'blk 2');
    });
  });

  testWidgets('an error is shown under the field', (tester) async {
    await pumpCard(tester, errorText: 'Choose the Phase, Block and Lot.');
    expect(find.text('Choose the Phase, Block and Lot.'), findsOneWidget);
  });
}
