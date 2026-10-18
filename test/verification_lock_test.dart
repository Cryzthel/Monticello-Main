import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/auth/widgets/verification_lock.dart';

Future<void> _pump(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));
}

void main() {
  group('who gets locked', () {
    test('an OBSERVED unverified status locks reporting', () {
      expect(ResidentVerification.pending.locksReporting, isTrue);
      expect(ResidentVerification.rejected.locksReporting, isTrue);
    });

    test('a verified resident is never locked', () {
      expect(ResidentVerification.verified.locksReporting, isFalse);
    });

    test('UNKNOWN does not lock — this is the load-bearing one', () {
      // Firestore's snapshots() does not error when it cannot reach the
      // server, it waits. Treating "we have not been told yet" as "not
      // verified" would put a padlock on every verified resident's screen on
      // every cold start, and turn a dead connection into an accusation.
      // firestore.rules is the real boundary; this client check is a courtesy.
      expect(ResidentVerification.unknown.locksReporting, isFalse);
    });
  });

  group('the copy', () {
    test('pending says exactly what the resident cannot do', () {
      expect(ResidentVerification.pending.lockHeadline, 'Verification Pending');
      expect(
        ResidentVerification.pending.lockBody,
        'Your account is currently under review by the HOA. You cannot '
        'submit or select incident categories until your account is verified.',
      );
    });

    test('a rejected account is not told it is still being reviewed', () {
      expect(ResidentVerification.rejected.lockHeadline, 'Account Not Approved');
      expect(ResidentVerification.rejected.lockBody, contains('did not approve'));
      // Nowhere in the app to fix it, so it points at the people who can.
      expect(
        ResidentVerification.rejected.lockBody,
        contains('Contact the HOA office'),
      );
    });

    test('no copy promises a self-serve verification screen', () {
      // The "Verify Your Property" wizard is gone. Any surviving string that
      // told a resident to go and verify would be a dead end.
      for (final status in ResidentVerification.values) {
        expect(status.lockBody.toLowerCase(), isNot(contains('verify your')));
        expect(status.lockBody.toLowerCase(), isNot(contains('upload')));
      }
    });
  });

  group('the read-only status badge', () {
    test('reads as an account state, not an instruction', () {
      expect(ResidentVerification.verified.badgeLabel, 'HOA Verified');
      expect(ResidentVerification.pending.badgeLabel, 'Pending HOA Approval');
      expect(ResidentVerification.rejected.badgeLabel, 'Not Approved');
    });

    test('an unread status shows as pending, not as verified', () {
      // Opposite default to the LOCK, deliberately. A badge describes the
      // account — and every account starts pending — where the lock must not
      // act on a status it has never actually read.
      expect(ResidentVerification.unknown.badgeLabel, 'Pending HOA Approval');
    });

    testWidgets('renders its label and cannot be tapped', (tester) async {
      await _pump(
        tester,
        const VerificationStatusBadge(status: ResidentVerification.pending),
      );

      expect(find.text('Pending HOA Approval'), findsOneWidget);
      // No gesture detector, no InkWell — it is a statement, not a control.
      expect(find.byType(InkWell), findsNothing);
      expect(find.byType(GestureDetector), findsNothing);
    });
  });

  group('VerificationBanner', () {
    testWidgets('explains the lock before anything is tapped', (tester) async {
      await _pump(
        tester,
        const VerificationBanner(status: ResidentVerification.pending),
      );

      expect(find.text('Verification Pending'), findsOneWidget);
      expect(find.textContaining('under review by the HOA'), findsOneWidget);
    });

    testWidgets('offers no route out, because there is none', (tester) async {
      await _pump(
        tester,
        const VerificationBanner(status: ResidentVerification.pending),
      );

      expect(find.text('View verification status'), findsNothing);
      expect(find.text('Verify Account Now'), findsNothing);
      expect(find.byIcon(Icons.arrow_forward), findsNothing);
    });
  });

  group('the lock dialog', () {
    Future<void> openDialog(
      WidgetTester tester,
      ResidentVerification status,
    ) async {
      await _pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showVerificationRequiredDialog(context, status),
            child: const Text('OPEN'),
          ),
        ),
      );
      await tester.tap(find.text('OPEN'));
      await tester.pumpAndSettle();
    }

    testWidgets('states the reason', (tester) async {
      await openDialog(tester, ResidentVerification.pending);

      expect(find.text('Verification Pending'), findsOneWidget);
      expect(
        find.textContaining('cannot submit or select incident categories'),
        findsOneWidget,
      );
    });

    testWidgets('has exactly one button, and it dismisses', (tester) async {
      await openDialog(tester, ResidentVerification.pending);

      expect(find.text('Got it'), findsOneWidget);
      expect(find.byType(ElevatedButton), findsOneWidget);
      expect(find.byType(TextButton), findsOneWidget); // the OPEN trigger only

      await tester.tap(find.text('Got it'));
      await tester.pumpAndSettle();

      expect(find.text('Verification Pending'), findsNothing);
      expect(find.text('OPEN'), findsOneWidget);
    });

    testWidgets('a rejected account gets its own wording', (tester) async {
      await openDialog(tester, ResidentVerification.rejected);

      expect(find.text('Account Not Approved'), findsOneWidget);
      expect(find.textContaining('Contact the HOA office'), findsOneWidget);
    });
  });

  group('VerificationLockBadge', () {
    testWidgets('is a padlock, sized as asked', (tester) async {
      await _pump(tester, const VerificationLockBadge(size: 24));

      final box = tester.getSize(find.byType(VerificationLockBadge));
      expect(box.width, 24);
      expect(box.height, 24);
      expect(find.byType(Icon), findsOneWidget);
    });
  });
}
