import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/core/widgets/staged_submit_button.dart';
import 'package:monticello_villas_app/features/auth/screens/login_screen.dart';
import 'package:monticello_villas_app/features/auth/services/email_rule.dart';
import 'package:monticello_villas_app/features/auth/services/password_policy.dart';
import 'package:monticello_villas_app/features/auth/services/verification_document_service.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/auth/widgets/property_pickers.dart';
import 'package:monticello_villas_app/features/auth/widgets/residency_proof_card.dart';
import 'package:monticello_villas_app/features/auth/widgets/resident_type_selector.dart';
import 'package:monticello_villas_app/features/media/widgets/photo_evidence_dropzone.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';

Widget _host(Widget child) => MaterialApp(
      theme: AppTheme.theme,
      home: Scaffold(
        body: Padding(padding: const EdgeInsets.all(16), child: child),
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  GoogleFonts.config.allowRuntimeFetching = false;

  group('VerificationIdRules', () {
    test('accepts photos and PDFs', () {
      for (final name in [
        'id.jpg',
        'ID.JPEG',
        'scan.png',
        'card.webp',
        'lease.pdf',
        'TITLE.PDF',
      ]) {
        expect(VerificationIdRules.validate(path: name, bytes: 500 * 1024),
            isNull,
            reason: name);
      }
    });

    test('refuses HEIC, documents that are not PDFs, and no extension', () {
      // HEIC passes the storage rule but a browser <img> cannot show it, so
      // staff would be handed a broken image to verify.
      for (final name in ['id.heic', 'lease.docx', 'id']) {
        expect(VerificationIdRules.validate(path: name, bytes: 1024),
            isNotNull,
            reason: name);
      }
    });

    test('mirrors the storage rule: strictly under 10 MB', () {
      const limit = VerificationIdRules.maxBytes;
      expect(VerificationIdRules.validate(path: 'a.jpg', bytes: limit - 1),
          isNull);
      expect(VerificationIdRules.validate(path: 'a.jpg', bytes: limit),
          contains('10 MB'));
    });

    test('refuses an empty file', () {
      expect(VerificationIdRules.validate(path: 'a.jpg', bytes: 0), isNotNull);
    });

    test('the helper text is the one the brief specified', () {
      expect(VerificationIdRules.requirementsLabel,
          'JPG, PNG, or PDF up to 10MB');
      expect(VerificationIdRules.contentTypeFor('lease.pdf'),
          'application/pdf');
      expect(VerificationIdRules.isPdf('/cache/LEASE.PDF'), isTrue);
    });

    test('reads the extension from a full device path', () {
      expect(
        VerificationIdRules.contentTypeFor(
            '/data/user/0/app/cache/image_picker_123.JPG'),
        'image/jpeg',
      );
      expect(VerificationIdRules.contentTypeFor(r'C:\tmp\scan.png'),
          'image/png');
    });

    test('formats sizes the way the card shows them', () {
      expect(VerificationIdRules.formatSize(840 * 1024), '840 KB');
      expect(VerificationIdRules.formatSize((2.4 * 1024 * 1024).round()),
          '2.4 MB');
    });
  });

  group('EmailRule', () {
    test('passes real addresses', () {
      for (final v in [
        'ana@example.com',
        ' Ana.Cruz+hoa@mail.example.ph ',
        'x@y.io',
      ]) {
        expect(EmailRule.validate(v), isNull, reason: v);
      }
    });

    test('catches the slips "contains @" let through', () {
      for (final v in ['a@', '@example.com', 'ana@example', 'ana @x.com', 'ana']) {
        expect(EmailRule.validate(v),
            'Enter a valid email address, like name@example.com.',
            reason: v);
      }
    });

    test('says "enter" for an empty field, not "invalid"', () {
      expect(EmailRule.validate('   '), 'Enter your email address.');
    });

    test('normalises the way the reset function keys its records', () {
      expect(EmailRule.normalize('  Ana@Example.COM '), 'ana@example.com');
    });
  });

  group('LoginScreen validation', () {
    Future<void> open(WidgetTester tester) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
          MaterialApp(theme: AppTheme.theme, home: const LoginScreen()));
      await tester.pump();
    }

    testWidgets('an empty form names both fields, under each one',
        (tester) async {
      await open(tester);
      await tester.tap(find.text('Sign In'));
      await tester.pump();
      expect(find.text('Enter your email address.'), findsOneWidget);
      expect(find.text('Enter your password.'), findsOneWidget);
    });

    testWidgets('a short password is not refused at sign-in',
        (tester) async {
      // It said "Minimum 6 characters" — a policy check on a sign-in field.
      await open(tester);
      await tester.enterText(find.byType(TextField).at(0), 'ana@example.com');
      await tester.enterText(find.byType(TextField).at(1), 'abc');
      await tester.tap(find.text('Sign In'));
      await tester.pump();
      expect(find.textContaining('Minimum'), findsNothing);
      expect(find.text('Enter your password.'), findsNothing);
      await tester.pump(const Duration(seconds: 1));
    });

    testWidgets('a half-typed email is caught before any network call',
        (tester) async {
      await open(tester);
      await tester.enterText(find.byType(TextField).at(0), 'ana@');
      await tester.tap(find.text('Sign In'));
      await tester.pump();
      expect(find.text('Enter a valid email address, like name@example.com.'),
          findsOneWidget);
    });
  });

  group('PasswordPolicy', () {
    test('is the same three rules everywhere', () {
      expect(PasswordPolicy.labels, hasLength(3));
      expect(PasswordPolicy.check('x'), hasLength(PasswordPolicy.labels.length));
    });

    test('the reset step no longer accepts a length-only password', () {
      // What Forgot Password used to let through.
      expect(PasswordPolicy.isStrong('aaaaaaaa'), isFalse);
      expect(PasswordPolicy.isStrong('aaaaaaa1'), isFalse);
      expect(PasswordPolicy.isStrong('aaaaaa1!'), isTrue);
    });
  });

  group('Registration address check', () {
    // Registration validates against the site-plan schedule, gaps included.
    test('keeps the site-plan gaps', () {
      expect(SubdivisionDirectory.exists('1', 3, 24), isFalse,
          reason: 'Phase 1 Block 3 starts at Lot 25');
      expect(SubdivisionDirectory.exists('1', 3, 25), isTrue);
      expect(SubdivisionDirectory.exists('2', 11, 2), isFalse,
          reason: 'Phase 2 Block 11 skips Lots 2-3');
      expect(SubdivisionDirectory.exists('2', 18, 1), isFalse,
          reason: 'Phase 2 Block 18 starts at Lot 2');
      expect(SubdivisionDirectory.exists('3', 1, 111), isTrue);
    });

    test('has no Phase 4 and no Phase 1 Block 1', () {
      expect(SubdivisionDirectory.loadedPhases, ['1', '2', '3', '5']);
      expect(SubdivisionDirectory.exists('1', 1, 1), isFalse);
      expect(SubdivisionDirectory.exists('4', 1, 1), isFalse);
    });
  });

  group('ResidentTypeSelector', () {
    testWidgets('shows each type with what it means', (tester) async {
      await tester.pumpWidget(_host(ResidentTypeSelector(
        value: ResidentType.homeowner,
        onChanged: (_) {},
      )));
      expect(find.text('Homeowner'), findsOneWidget);
      expect(find.text('Owns the unit'), findsOneWidget);
      expect(find.text('Tenant'), findsOneWidget);
      expect(find.text('Rents or leases'), findsOneWidget);
    });

    testWidgets('a tap selects, and re-tapping the selection is a no-op',
        (tester) async {
      final picks = <String>[];
      await tester.pumpWidget(_host(ResidentTypeSelector(
        value: ResidentType.homeowner,
        onChanged: picks.add,
      )));
      await tester.tap(find.text('Tenant'));
      await tester.tap(find.text('Homeowner'));
      await tester.pumpAndSettle();
      expect(picks, [ResidentType.tenant]);
    });

    testWidgets('announces itself as a checked radio-style choice',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(_host(ResidentTypeSelector(
        value: ResidentType.tenant,
        onChanged: (_) {},
      )));
      final tenant = tester.getSemantics(find.bySemanticsLabel(
          RegExp(r'^Tenant\. ')));
      expect(
        tenant,
        isSemantics(
          isButton: true,
          hasCheckedState: true,
          isChecked: true,
          isInMutuallyExclusiveGroup: true,
        ),
      );
      handle.dispose();
    });

    testWidgets('both cards are the same height', (tester) async {
      await tester.pumpWidget(_host(ResidentTypeSelector(
        value: ResidentType.homeowner,
        onChanged: (_) {},
      )));
      final owner = tester.getSize(find.ancestor(
          of: find.text('Homeowner'), matching: find.byType(AnimatedContainer)).first);
      final tenant = tester.getSize(find.ancestor(
          of: find.text('Tenant'), matching: find.byType(AnimatedContainer)).first);
      expect(owner.height, tenant.height);
    });
  });

  group('ResidencyProofCard', () {
    Widget card({
      File? file,
      String? name,
      IdUploadStatus status = IdUploadStatus.none,
      double? progress,
      String? error,
      VoidCallback? onPick,
      VoidCallback? onRemove,
    }) =>
        _host(ResidencyProofCard(
          file: file,
          fileName: name,
          bytes: file == null ? null : 2 * 1024 * 1024,
          status: status,
          progress: progress,
          error: error,
          onPick: onPick ?? () {},
          onRemove: onRemove ?? () {},
        ));

    double cardHeight(WidgetTester tester) => tester
        .getSize(find
            .descendant(
              of: find.byType(ResidencyProofCard),
              matching: find.byType(AnimatedSwitcher),
            )
            .first)
        .height;

    testWidgets('empty, it IS the evidence dropzone, with the ID copy',
        (tester) async {
      await tester.pumpWidget(card());
      expect(find.byType(PhotoEvidenceDropzone), findsOneWidget);
      expect(find.text('Tap to upload your ID'), findsOneWidget);
      expect(find.text('JPG, PNG, or PDF up to 10MB'), findsOneWidget);
    });

    testWidgets('tapping the dropzone opens the picker', (tester) async {
      var picks = 0;
      await tester.pumpWidget(card(onPick: () => picks++));
      await tester.tap(find.byType(PhotoEvidenceDropzone));
      expect(picks, 1);
    });

    testWidgets('a chosen file takes exactly the dropzone height',
        (tester) async {
      await tester.pumpWidget(card());
      await tester.pumpAndSettle();
      expect(cardHeight(tester), PhotoEvidenceDropzone.defaultHeight);

      for (final status in [
        IdUploadStatus.ready,
        IdUploadStatus.uploading,
        IdUploadStatus.failed,
      ]) {
        await tester.pumpWidget(card(
            file: File('lease.pdf'), name: 'lease.pdf', status: status));
        await tester.pump(const Duration(milliseconds: 300));
        expect(cardHeight(tester), PhotoEvidenceDropzone.defaultHeight,
            reason: '$status');
      }
    });

    testWidgets('a PDF shows its name, since it has no preview',
        (tester) async {
      await tester.pumpWidget(card(
          file: File('lease.pdf'),
          name: 'lease.pdf',
          status: IdUploadStatus.ready));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('lease.pdf'), findsOneWidget);
      expect(find.text('2.0 MB'), findsOneWidget);
    });

    testWidgets('every status is named in words', (tester) async {
      const labels = {
        IdUploadStatus.ready: 'Ready to upload',
        IdUploadStatus.uploading: 'Uploading',
        IdUploadStatus.uploaded: 'Uploaded',
        IdUploadStatus.failed: 'Upload failed',
      };
      for (final entry in labels.entries) {
        await tester.pumpWidget(card(
            file: File('lease.pdf'), name: 'lease.pdf', status: entry.key));
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.text(entry.value), findsOneWidget, reason: '${entry.key}');
      }
    });

    testWidgets('uploading shows the transfer percentage', (tester) async {
      await tester.pumpWidget(card(
          file: File('lease.pdf'),
          name: 'lease.pdf',
          status: IdUploadStatus.uploading,
          progress: 0.42));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Uploading 42%'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
    });

    testWidgets('replace and remove are offered until the upload starts',
        (tester) async {
      var removed = 0;
      var picks = 0;
      await tester.pumpWidget(card(
          file: File('lease.pdf'),
          name: 'lease.pdf',
          status: IdUploadStatus.ready,
          onPick: () => picks++,
          onRemove: () => removed++));
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.bySemanticsLabel('Remove ID'));
      await tester.tap(find.bySemanticsLabel('Replace ID'));
      expect(removed, 1);
      expect(picks, 1);

      await tester.pumpWidget(card(
          file: File('lease.pdf'),
          name: 'lease.pdf',
          status: IdUploadStatus.uploading));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.bySemanticsLabel('Remove ID'), findsNothing);
      expect(find.bySemanticsLabel('Replace ID'), findsNothing);
    });

    testWidgets('shows a validation error under the card', (tester) async {
      await tester.pumpWidget(card(error: 'Use a JPG, PNG, or PDF file.'));
      await tester.pumpAndSettle();
      expect(find.text('Use a JPG, PNG, or PDF file.'), findsOneWidget);
    });
  });

  group('MediaRemoveButton', () {
    testWidgets('draws a 24pt disc inside a 44pt target', (tester) async {
      await tester.pumpWidget(
          _host(Center(child: MediaRemoveButton(onTap: () {}))));
      expect(tester.getSize(find.byType(MediaRemoveButton)),
          const Size(44, 44));
    });
  });

  group('Property pickers', () {
    Widget field({
      required List<String> options,
      String? value,
      ValueChanged<String>? onChanged,
      String label = 'Lot',
    }) =>
        _host(PropertyNumberField(
          label: label,
          options: options,
          value: value,
          disabledHint: 'Choose a block first.',
          onChanged: onChanged ?? (_) {},
        ));

    List<String> lotsOf(String phase, int block) => [
          for (final spec in SubdivisionDirectory.blocksIn(phase))
            if (spec.block == block)
              for (final run in spec.runs)
                for (var lot = run.first; lot <= run.last; lot++) '$lot',
        ];

    testWidgets('Phase opens a sheet of the four real phases',
        (tester) async {
      String? picked;
      await tester.pumpWidget(field(
        label: 'Phase',
        options: SubdivisionDirectory.loadedPhases,
        onChanged: (v) => picked = v,
      ));
      // Floating-label pattern: empty shows the label resting in the box,
      // not a separate "Select" placeholder.
      expect(find.text('Phase'), findsOneWidget);
      expect(find.text('Select'), findsNothing);
      await tester.tap(find.byType(PropertyNumberField));
      await tester.pumpAndSettle();
      expect(find.text('4 phases'), findsOneWidget);
      Finder tile(String n) =>
          find.descendant(of: find.byType(GridView), matching: find.text(n));
      for (final phase in ['1', '2', '3', '5']) {
        expect(tile(phase), findsOneWidget);
      }
      expect(tile('4'), findsNothing);
      await tester.tap(tile('3'));
      await tester.pumpAndSettle();
      expect(picked, '3');
    });

    testWidgets('Phase, Block and Lot are three equal cards in one row',
        (tester) async {
      await tester.pumpWidget(_host(Row(
        children: [
          for (final label in ['Phase', 'Block', 'Lot']) ...[
            if (label != 'Phase') const SizedBox(width: 10),
            Expanded(
              child: PropertyNumberField(
                label: label,
                options: const ['1'],
                value: label == 'Phase' ? '2' : null,
                disabledHint: '',
                onChanged: (_) {},
              ),
            ),
          ],
        ],
      )));
      final sizes = tester
          .widgetList(find.byType(PropertyNumberField))
          .map((w) => tester.getSize(find.byWidget(w)))
          .toList();
      expect(sizes, hasLength(3));
      expect(sizes.map((s) => s.height).toSet(), {PropertyNumberField.height});
      expect(sizes.map((s) => s.width.round()).toSet(), hasLength(1));
      // Filled or not, the card does not change size.
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('the lot sheet scrolls all the way to Lot 111',
        (tester) async {
      // The regression this replaced: the inline list sat inside the form's
      // scroll view and collapsed on the first drag, so nobody could reach
      // the far end of a long block. Phase 3 Block 1 is the longest.
      String? picked;
      final lots = lotsOf('3', 1);
      expect(lots.last, '111');
      await tester.pumpWidget(
          field(options: lots, onChanged: (v) => picked = v));
      await tester.tap(find.byType(PropertyNumberField));
      await tester.pumpAndSettle();
      expect(find.text('Choose Lot'), findsOneWidget);

      await tester.scrollUntilVisible(
        find.text('111'),
        200,
        scrollable: find.descendant(
            of: find.byType(GridView), matching: find.byType(Scrollable)),
      );
      // Built is not the same as on screen: bring the whole tile into view.
      await tester.ensureVisible(find.text('111'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('111'));
      await tester.pumpAndSettle();
      expect(picked, '111');
      expect(find.text('Choose Lot'), findsNothing); // the sheet closed
    });

    testWidgets('the sheet offers only real lots — gaps stay gaps',
        (tester) async {
      // Phase 2 Block 11 has 46 lots spread over 1-56.
      final lots = lotsOf('2', 11);
      await tester.pumpWidget(field(options: lots));
      await tester.tap(find.byType(PropertyNumberField));
      await tester.pumpAndSettle();
      expect(find.text('46 lots'), findsOneWidget);
      // Lot 2 does not exist; jump straight to it and find nothing.
      await tester.enterText(
          find.descendant(
              of: find.byType(AuthField).last,
              matching: find.byType(TextField)),
          '2');
      await tester.pump();
      // In the grid — the jump field itself now reads "2".
      Finder tile(String n) =>
          find.descendant(of: find.byType(GridView), matching: find.text(n));
      expect(tile('2'), findsNothing);
      expect(tile('21'), findsOneWidget);
    });

    testWidgets('the sheet opens with the current choice in view',
        (tester) async {
      await tester.pumpWidget(field(options: lotsOf('3', 1), value: '100'));
      await tester.tap(find.byType(PropertyNumberField));
      await tester.pumpAndSettle();
      expect(find.text('100'), findsWidgets);
      expect(
          find.descendant(
              of: find.byType(GridView), matching: find.text('100')),
          findsOneWidget);
    });

    testWidgets('a field waiting on the choice above says so when tapped',
        (tester) async {
      await tester.pumpWidget(field(options: const []));
      await tester.tap(find.byType(PropertyNumberField));
      await tester.pump();
      expect(find.text('Choose a block first.'), findsOneWidget);
      expect(find.text('Choose Lot'), findsNothing);
    });

    testWidgets('the field never raises the keyboard', (tester) async {
      await tester.pumpWidget(field(options: lotsOf('1', 2)));
      await tester.tap(find.byType(PropertyNumberField));
      await tester.pumpAndSettle();
      expect(tester.testTextInput.isVisible, isFalse);
    });
  });

  group('Primary buttons: one loading look, one disabled look', () {
    double opacityOf(WidgetTester tester) => tester
        .widget<Opacity>(find.descendant(
            of: find.byType(AuthButton), matching: find.byType(Opacity)))
        .opacity;

    testWidgets('AuthButton shows the spinner by default while busy',
        (tester) async {
      await tester.pumpWidget(
          _host(AuthButton(label: 'Sign In', busy: true, onPressed: () {})));
      expect(find.byType(LeafLoader), findsOneWidget);
      expect(find.text('Sign In'), findsNothing);
    });

    testWidgets('busy keeps full colour; disabled fades', (tester) async {
      await tester.pumpWidget(
          _host(AuthButton(label: 'Go', busy: true, onPressed: () {})));
      expect(opacityOf(tester), 1);
      await tester.pumpWidget(
          _host(const AuthButton(label: 'Go', onPressed: null)));
      expect(opacityOf(tester), 0.6);
    });

    testWidgets('StagedSubmitButton fades the same 60% when disabled, '
        'and not at all when busy', (tester) async {
      Color? disabledFill(WidgetTester tester) => tester
          .widget<ElevatedButton>(find.byType(ElevatedButton))
          .style!
          .backgroundColor!
          .resolve({WidgetState.disabled});

      await tester.pumpWidget(_host(const StagedSubmitButton(
          label: 'Submit', onPressed: null, color: AuthTokens.brand)));
      expect(disabledFill(tester), AuthTokens.brand.withValues(alpha: 0.6));

      await tester.pumpWidget(_host(StagedSubmitButton(
          label: 'Submit',
          onPressed: () {},
          busy: true,
          color: AuthTokens.brand)));
      expect(disabledFill(tester), AuthTokens.brand);
      expect(find.byType(LeafLoader), findsOneWidget);
    });
  });

  group('DismissKeyboardOnTap', () {
    testWidgets('a tap on empty space drops focus', (tester) async {
      final node = FocusNode();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: DismissKeyboardOnTap(
            child: SizedBox.expand(
              child: Align(
                alignment: Alignment.topCenter,
                child: TextField(focusNode: node),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.byType(TextField));
      await tester.pump();
      expect(node.hasFocus, isTrue);

      await tester.tapAt(const Offset(200, 500));
      await tester.pump();
      expect(node.hasFocus, isFalse);
      node.dispose();
    });
  });
}
