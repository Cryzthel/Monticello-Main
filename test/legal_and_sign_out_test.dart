import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/legal/legal_content.dart';
import 'package:monticello_villas_app/features/legal/legal_document_view.dart';
import 'package:monticello_villas_app/features/settings/widgets/sign_out_dialog.dart';

void main() {
  group('legal content', () {
    test('Terms carry the supplied date and all seven sections', () {
      expect(termsAndConditions.title, 'Terms and Conditions');
      expect(termsAndConditions.lastUpdated, 'September 2, 2026');
      expect(termsAndConditions.sections.map((s) => s.heading), [
        '1. Acceptance of Terms',
        '2. Eligibility and Account Verification',
        '3. Proper Use of the Application and Incident Reporting',
        '4. Emergency Alerts and Internet Connectivity',
        '5. User Content and Uploaded Media',
        '6. Intellectual Property',
        '7. Suspension or Termination',
      ]);
    });

    test('the prohibited-use list is five real bullets', () {
      final bullets = termsAndConditions.sections[2].blocks
          .firstWhere((b) => b.bullets != null)
          .bullets!;
      expect(bullets, hasLength(5));
      expect(bullets.first, 'Making false or misleading incident reports.');
    });

    test('Privacy Policy has its six sections and cites RA 10173', () {
      expect(privacyPolicy.sections, hasLength(6));
      expect(privacyPolicy.sections.last.heading, '6. Contact Us');
      final all = privacyPolicy.sections
          .expand((s) => s.blocks)
          .map((b) => b.text ?? '')
          .join(' ');
      expect(all, contains('Republic Act No. 10173'));
      expect(all, contains(kPrivacyEmail));
    });
  });

  testWidgets('the reader renders headings, bullets and the date',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: LegalDocumentScreen(document: termsAndConditions),
    ));
    expect(find.text('Terms and Conditions'), findsOneWidget);
    expect(find.text('Last Updated: September 2, 2026'), findsOneWidget);
    expect(find.text('1. Acceptance of Terms'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Using the SOS button without a legitimate emergency.'),
      200,
    );
    expect(tester.takeException(), isNull);
  });

  group('sign-out confirmation', () {
    late List<bool> answers;

    Future<void> open(WidgetTester tester) async {
      answers = [];
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => answers.add(await confirmSignOut(context)),
              child: const Text('Sign out'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(find.text('Are you sure you want to log out?'), findsOneWidget);
    }

    testWidgets('Log Out confirms', (tester) async {
      await open(tester);
      await tester.tap(find.text('Log Out'));
      await tester.pumpAndSettle();
      expect(answers, [true]);
      expect(find.text('Are you sure you want to log out?'), findsNothing);
    });

    testWidgets('Cancel keeps the session', (tester) async {
      await open(tester);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(answers, [false]);
    });

    testWidgets('tapping the backdrop keeps the session', (tester) async {
      await open(tester);
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(answers, [false]);
    });
  });
}
