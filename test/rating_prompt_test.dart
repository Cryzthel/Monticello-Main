import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/incidents/widgets/rating_prompt.dart';

Incident _incident({
  IncidentStatus status = IncidentStatus.resolved,
  DateTime? ratingRequestedAt,
  int? stars,
}) {
  return Incident(
    id: 'abcdefgh12345',
    title: 'Gate left open',
    category: 'security',
    phase: '2',
    block: '7',
    lot: '14',
    description: '',
    reportedAt: DateTime(2026, 9, 22, 10),
    priority: IncidentPriority.high,
    status: status,
    reporter: 'Resident',
    assignedGuardName: 'Ana Cruz',
    ratingRequestedAt: ratingRequestedAt,
    residentRatingStars: stars,
  );
}

void main() {
  group('Incident.awaitsRating', () {
    final asked = DateTime(2026, 9, 22, 11);

    test('resolved, asked, not rated', () {
      expect(_incident(ratingRequestedAt: asked).awaitsRating, isTrue);
    });
    test('not asked (resolved before the stage machine)', () {
      expect(_incident().awaitsRating, isFalse);
    });
    test('already rated', () {
      expect(
          _incident(ratingRequestedAt: asked, stars: 4).awaitsRating, isFalse);
    });
    test('still open', () {
      expect(
        _incident(status: IncidentStatus.inProgress, ratingRequestedAt: asked)
            .awaitsRating,
        isFalse,
      );
    });
  });

  testWidgets(
      'the sheet needs a star before it can submit, and Not now closes it',
      (tester) async {
    bool? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await showResponseRatingSheet(
                context,
                _incident(ratingRequestedAt: DateTime(2026, 9, 22, 11)),
              );
            },
            child: const Text('open'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('How did security do?'), findsOneWidget);
    expect(find.textContaining('INC-ABCDEFGH'), findsOneWidget);
    expect(find.textContaining('resolved by Ana Cruz'), findsOneWidget);

    ElevatedButton submit() => tester.widget<ElevatedButton>(
        find.widgetWithText(ElevatedButton, 'Submit rating'));
    expect(submit().onPressed, isNull);
    expect(find.text('Tap a star'), findsOneWidget);

    await tester.tap(find.byType(IconButton).at(3));
    await tester.pump();
    expect(find.text('Very good'), findsOneWidget);
    expect(submit().onPressed, isNotNull);

    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();
    expect(find.text('How did security do?'), findsNothing);
    expect(result, isFalse);
  });
}
