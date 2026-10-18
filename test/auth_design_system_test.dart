import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/brand/brand_mark.dart';
import 'package:monticello_villas_app/core/network/connectivity_probe.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/contact/widgets/hoa_contact_sheet.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sms_fallback.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/staged_submit_button.dart';
import 'package:monticello_villas_app/features/auth/screens/login_screen.dart';
import 'package:monticello_villas_app/features/auth/screens/sign_up_screen.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_scaffold.dart';

/// The capsule a field draws, found by its decoration rather than by its
/// position in the tree, so a refactor that re-nests the widget does not
/// silently stop testing anything.
BoxDecoration _capsuleOf(WidgetTester tester) {
  final container = tester.widgetList<AnimatedContainer>(
    find.descendant(
      of: find.byType(AuthField),
      matching: find.byType(AnimatedContainer),
    ),
  ).firstWhere((c) => c.decoration is BoxDecoration &&
      (c.decoration! as BoxDecoration).borderRadius != null);
  return container.decoration! as BoxDecoration;
}

/// The capsule's OUTLINE, which lives in `foregroundDecoration` rather than
/// `decoration` so that its width can change on focus without insetting the
/// child — see the note in auth_controls.dart.
BoxDecoration _capsuleOutline(WidgetTester tester) {
  final container = tester.widgetList<AnimatedContainer>(
    find.descendant(
      of: find.byType(AuthField),
      matching: find.byType(AnimatedContainer),
    ),
  ).firstWhere((c) => c.foregroundDecoration is BoxDecoration);
  return container.foregroundDecoration! as BoxDecoration;
}

/// The capsule's own rect. NOT `find.byType(AuthField)` — since the floating
/// label landed, the field reserves a strip above the capsule for the label to
/// overhang into, so the widget is taller than the control it draws.
Rect _capsuleRect(WidgetTester tester) => tester.getRect(
      find
          .descendant(
            of: find.byType(AuthField),
            matching: find.byType(AnimatedContainer),
          )
          .first,
    );

Widget _host(Widget child, {GlobalKey<FormState>? formKey}) {
  return MaterialApp(
    theme: AppTheme.theme,
    home: Scaffold(
      body: Form(key: formKey, child: Padding(
        padding: const EdgeInsets.all(16),
        child: child,
      )),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Every `sfPro()` in the tree would otherwise reach fonts.gstatic.com.
  GoogleFonts.config.allowRuntimeFetching = false;

  group('AuthField geometry', () {
    testWidgets('is a capsule at the portals\' control height', (tester) async {
      final controller = TextEditingController();
      await tester.pumpWidget(_host(AuthField(
        controller: controller,
        hint: 'you@example.com',
      )));
      await tester.pump();

      final decoration = _capsuleOf(tester);
      final radius = (decoration.borderRadius! as BorderRadius).topLeft.x;
      final height = _capsuleRect(tester).height;

      // "Oblong" is only true if the radius reaches at least half the height;
      // anything less is a rounded rectangle wearing a large number.
      expect(radius, greaterThanOrEqualTo(height / 2));
      // moreOrLessEquals throughout this group: the label overhang is
      // `floatedLabelBox / 2`, which lands a float's-width off a whole
      // number and propagates into the capsule's own rect.
      expect(height, moreOrLessEquals(AuthTokens.controlHeight, epsilon: 0.01));
      expect(decoration.color, AuthTokens.fill);

      // The field as a whole is taller by exactly the label's overhang, and
      // that strip is reserved whether or not the label is currently up.
      expect(
        tester.getSize(find.byType(AuthField)).height,
        moreOrLessEquals(
          AuthTokens.controlHeight + AuthTokens.labelOverhang,
          epsilon: 0.01,
        ),
      );
    });

    testWidgets('matches the CTA height exactly', (tester) async {
      // A 48pt field over a 54pt button is the kind of six-pixel disagreement
      // that makes a form look assembled rather than designed.
      await tester.pumpWidget(_host(Column(children: [
        AuthField(
          controller: TextEditingController(),
          hint: 'x',
        ),
        AuthButton(label: 'Sign In', onPressed: () {}),
      ])));
      await tester.pump();

      expect(
        _capsuleRect(tester).height,
        moreOrLessEquals(
          tester.getSize(find.byType(AuthButton)).height,
          epsilon: 0.01,
        ),
      );
    });

    testWidgets('draws exactly ONE outline', (tester) async {
      // ── THE DOUBLE BORDER ────────────────────────────────────────────
      // `InputDecoration` merges the ambient `inputDecorationTheme` into
      // every slot the call site leaves null, and this app's theme fills
      // `enabledBorder` and `focusedBorder` with a pill in emerald-100. So
      // a TextField that sets only `border: InputBorder.none` still drew
      // its own pill inside the capsule around it — two concentric
      // outlines per field, visible on a device and easy to mistake for
      // antialiasing in a 1x golden.
      await tester.pumpWidget(_host(AuthField(
        controller: TextEditingController(),
        hint: 'you@example.com',
      )));
      await tester.pump();

      final decoration = tester
          .widget<TextField>(find.byType(TextField))
          .decoration!;
      for (final border in <InputBorder?>[
        decoration.border,
        decoration.enabledBorder,
        decoration.focusedBorder,
        decoration.errorBorder,
        decoration.focusedErrorBorder,
        decoration.disabledBorder,
      ]) {
        expect(border, InputBorder.none);
      }
      // The capsule paints the fill; a second one is a rounded patch inside
      // a rounded box the moment the two colours differ.
      expect(decoration.filled, isFalse);
    });

    testWidgets('focuses in neutral ink, never in brand green',
        (tester) async {
      // Green is reserved for what you can ACT on — links and the primary
      // button — and for the mark. Focus is a state, so it darkens the
      // border instead of colouring it. A side effect worth keeping: red is
      // now the only coloured border, so an error is the one thing on the
      // form that changes hue.
      await tester.pumpWidget(_host(AuthField(
        label: 'Email',
        controller: TextEditingController(),
        hint: 'you@example.com',
      )));
      await tester.pump();

      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();

      final outline = _capsuleOutline(tester);
      expect(outline.border!.top.color, AuthTokens.focusBorder);
      expect(outline.border!.top.color, isNot(AuthTokens.brand));
    });

    test('a 1pt focus border earns back in contrast what it lost in width',
        () {
      // The stroke is 1pt by request, which forfeits WCAG 2.2 Focus
      // Appearance (AAA) — that criterion wants a 2px perimeter and no
      // amount of contrast substitutes for area. What must still hold is
      // the AA bar: a VISIBLE indicator. So the colour was darkened from
      // slate-500 to slate-700 at the same time, and the floor asserted
      // here is deliberately well above the 3:1 minimum.
      double channel(double c) =>
          c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4) as double;
      double luminance(Color c) =>
          0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
      double ratio(Color a, Color b) {
        final la = luminance(a), lb = luminance(b);
        return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
      }

      // The resting border is slate-200 at 80% over the field's white fill.
      final resting = Color.alphaBlend(AuthTokens.border, AuthTokens.fill);

      // 8.63:1 against the resting border, 10.3:1 against the fill.
      expect(ratio(AuthTokens.focusBorder, resting), greaterThan(6));
      expect(ratio(AuthTokens.focusBorder, AuthTokens.fill), greaterThan(6));
    });

    testWidgets('thickens its border on focus, and casts no shadow at all',
        (tester) async {
      // The field is flat in every state. A focused input that lifts off the
      // page is elevation drawn with a shadow primitive, and this form has
      // no other soft edge on it.
      await tester.pumpWidget(_host(AuthField(
        controller: TextEditingController(),
        hint: 'you@example.com',
      )));
      await tester.pump();

      expect(_capsuleOf(tester).boxShadow, anyOf(isNull, isEmpty));
      expect(_capsuleOutline(tester).boxShadow, anyOf(isNull, isEmpty));
      expect(_capsuleOutline(tester).border!.top.width, 1);

      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();

      // Still flat, and still 1pt — the indicator is the stroke's COLOUR.
      expect(_capsuleOf(tester).boxShadow, anyOf(isNull, isEmpty));
      expect(_capsuleOutline(tester).boxShadow, anyOf(isNull, isEmpty));
      expect(_capsuleOutline(tester).border!.top.width, 1);
      expect(_capsuleOutline(tester).border!.top.color,
          AuthTokens.focusBorder);
    });

    testWidgets('the thicker border does not move the content',
        (tester) async {
      // Why the outline is painted in `foregroundDecoration`: a border in
      // `decoration` insets the child by its width, so growing it on focus
      // would shift the text inward by a point. That reflow is a bug this
      // widget already fixed once.
      await tester.pumpWidget(_host(AuthField(
        label: 'Email',
        controller: TextEditingController(),
        hint: 'you@example.com',
      )));
      await tester.pump();
      final text = tester.getTopLeft(find.byType(EditableText));
      final capsule = _capsuleRect(tester);

      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();

      expect(tester.getTopLeft(find.byType(EditableText)), text);
      expect(_capsuleRect(tester), capsule);
    });

    testWidgets('there is no leading glyph, and the label rises straight up',
        (tester) async {
      // The floating label names the field; an envelope or a padlock in
      // front of it said the same thing again. With the glyph gone the
      // resting label and the floated one share an x, so the label moves
      // vertically only.
      await tester.pumpWidget(_host(AuthField(
        label: 'Email',
        controller: TextEditingController(),
        hint: 'you@example.com',
      )));
      await tester.pump();
      expect(find.byType(Icon), findsNothing);

      final restingX = tester.getTopLeft(find.text('Email')).dx;
      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();
      // The floated label sits in a notch padded 5pt each side, so its text
      // starts 5pt right of where the resting text did.
      expect(tester.getTopLeft(find.text('Email')).dx, restingX + 5);
    });
  });

  group('AuthField floating label', () {
    Future<AuthField> pump(WidgetTester tester,
        {required TextEditingController controller}) async {
      final field = AuthField(
        label: 'Email',
        controller: controller,
        hint: 'you@example.com',
      );
      await tester.pumpWidget(_host(field));
      await tester.pump();
      return field;
    }

    Offset labelOffset(WidgetTester tester) =>
        tester.getTopLeft(find.text('Email'));

    testWidgets('rests as the placeholder, with no hint beside it',
        (tester) async {
      await pump(tester, controller: TextEditingController());

      // ONE piece of text in the capsule at rest. The label is doing the
      // placeholder's job; showing the real placeholder too would stack two
      // greys on one line.
      expect(find.text('Email'), findsOneWidget);
      expect(find.text('you@example.com'), findsNothing);
      // Sitting inside the capsule, below its top edge.
      expect(labelOffset(tester).dy, greaterThan(_capsuleRect(tester).top));
    });

    testWidgets('floats onto the border on focus, and reveals the hint',
        (tester) async {
      await pump(tester, controller: TextEditingController());
      final resting = labelOffset(tester);

      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();

      final floated = labelOffset(tester);
      expect(floated.dy, lessThan(resting.dy));
      // No glyph to come out from behind any more: the label rises straight
      // up, shifted only by the 5pt notch padding either side of it.
      expect(floated.dx, resting.dx + 5);
      // Straddling the capsule's top border rather than clearing it.
      expect(floated.dy, lessThan(_capsuleRect(tester).top));
      expect(
        floated.dy + AuthTokens.floatedLabelBox,
        greaterThan(_capsuleRect(tester).top),
      );
      expect(find.text('you@example.com'), findsOneWidget);
    });

    testWidgets('stays floated for a filled but unfocused field',
        (tester) async {
      // The whole reason a floating label beats a placeholder: the field's
      // name survives being filled in.
      final controller = TextEditingController(text: 'resident@example.com');
      await pump(tester, controller: controller);
      await tester.pumpAndSettle();

      expect(find.text('Email'), findsOneWidget);
      expect(labelOffset(tester).dy, lessThan(_capsuleRect(tester).top));
    });

    testWidgets('focusing does not move the capsule', (tester) async {
      // The layout bug this guards: if the overhang were reserved only while
      // floated, every control below the field would jump down the first
      // time it was tapped.
      await pump(tester, controller: TextEditingController());
      final before = _capsuleRect(tester);

      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();

      expect(_capsuleRect(tester), before);
    });
  });

  group('AuthField validation', () {
    testWidgets('renders the error BELOW the capsule, not inside it',
        (tester) async {
      final formKey = GlobalKey<FormState>();
      await tester.pumpWidget(_host(
        AuthField(
          controller: TextEditingController(),
          hint: 'you@example.com',
          validator: (v) => v.isEmpty ? 'Enter an email' : null,
        ),
        formKey: formKey,
      ));
      await tester.pump();

      final capsuleBefore = tester.getRect(find.byType(AnimatedContainer).first);
      formKey.currentState!.validate();
      await tester.pumpAndSettle();

      expect(find.text('Enter an email'), findsOneWidget);
      // The capsule itself must not move or grow to make room — otherwise
      // every control below a failing field jumps mid-validation. This is
      // also what pins the border width: thickening it on error would make
      // the box a pixel taller and fail here.
      expect(
        tester.getRect(find.byType(AnimatedContainer).first),
        capsuleBefore,
      );
      expect(
        tester.getRect(find.text('Enter an email')).top,
        greaterThanOrEqualTo(capsuleBefore.bottom),
      );
    });

    testWidgets('validates the CONTROLLER, not a stale FormField value',
        (tester) async {
      // The remembered-email case: the controller is filled programmatically
      // after the first build, and a validator reading the FormField's own
      // value would reject a field the resident can plainly see is filled.
      final controller = TextEditingController();
      final formKey = GlobalKey<FormState>();
      await tester.pumpWidget(_host(
        AuthField(
          controller: controller,
          hint: 'you@example.com',
          validator: (v) => v.contains('@') ? null : 'Enter a valid email',
        ),
        formKey: formKey,
      ));
      await tester.pump();

      controller.text = 'resident@example.com';
      await tester.pump();

      expect(formKey.currentState!.validate(), isTrue);
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid email'), findsNothing);
    });

    testWidgets('clears the error as soon as the input becomes valid',
        (tester) async {
      final formKey = GlobalKey<FormState>();
      await tester.pumpWidget(_host(
        AuthField(
          controller: TextEditingController(),
          hint: 'you@example.com',
          validator: (v) => v.contains('@') ? null : 'Enter a valid email',
        ),
        formKey: formKey,
      ));
      await tester.pump();
      formKey.currentState!.validate();
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid email'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'resident@example.com');
      await tester.pumpAndSettle();
      expect(find.text('Enter a valid email'), findsNothing);
    });
  });

  group('AuthButton', () {
    testWidgets('is a capsule in the deep brand green', (tester) async {
      await tester.pumpWidget(_host(
        AuthButton(label: 'Sign In', onPressed: () {}),
      ));
      await tester.pump();

      final decoration = tester
          .widget<AnimatedContainer>(find.descendant(
            of: find.byType(AuthButton),
            matching: find.byType(AnimatedContainer),
          ))
          .decoration! as BoxDecoration;
      final radius = (decoration.borderRadius! as BorderRadius).topLeft.x;

      expect(decoration.color, AuthTokens.brand);
      expect(radius,
          greaterThanOrEqualTo(AuthTokens.controlHeight / 2));
      // White on #047857 is 5.6:1. White on the old #16A34A was 3.3:1 —
      // under the floor for 14px text.
      expect(AuthTokens.onBrand, const Color(0xFFFFFFFF));
      // The app's accent has since been repointed to this same value, so
      // these now AGREE. That is the end state the threshold was always
      // ahead of, not a regression: assert the convergence so nobody
      // "restores" the split.
      expect(AuthTokens.brand, AppColors.primary);
    });

    testWidgets('does not fire while busy', (tester) async {
      var taps = 0;
      await tester.pumpWidget(_host(AuthButton(
        label: 'Sign In',
        busy: true,
        onPressed: () => taps++,
      )));
      await tester.pump();

      await tester.tap(find.byType(AuthButton));
      await tester.pump();
      expect(taps, 0);
    });
  });

  group('LoginScreen', () {
    testWidgets('opens with the real emblem, not a stand-in glyph',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(theme: AppTheme.theme, home: const LoginScreen()),
      );
      await tester.pump();

      expect(find.byType(BrandMark), findsOneWidget);
      // The 72px green tile with a Phosphor shield in it is gone.
      expect(find.byIcon(PhosphorIconsFill.shield), findsNothing);
    });

    testWidgets('uses the shared capsule controls', (tester) async {
      await tester.pumpWidget(
        MaterialApp(theme: AppTheme.theme, home: const LoginScreen()),
      );
      await tester.pump();

      expect(find.byType(AuthField), findsNWidgets(2));
      expect(find.byType(AuthButton), findsOneWidget);
      // No screen-local InputDecoration borders left behind.
      expect(find.byType(TextFormField), findsNothing);
    });

    testWidgets('fits a 375pt viewport without overflowing', (tester) async {
      tester.view.physicalSize = const Size(375, 667);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(theme: AppTheme.theme, home: const LoginScreen()),
      );
      await tester.pump();

      // An overflow is reported as a FlutterError during paint, which the
      // binding records; `takeException` surfaces it as a test failure here
      // rather than as a stripe nobody looks at.
      expect(tester.takeException(), isNull);
    });
  });

  group('SignUpScreen', () {
    Future<void> open(WidgetTester tester) async {
      tester.view.physicalSize = const Size(375, 667);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(theme: AppTheme.theme, home: const SignUpScreen()),
      );
      await tester.pump();
    }

    testWidgets('has no step progress indicator', (tester) async {
      await open(tester);

      // The rail, the numbered discs, the two stage labels and the caption —
      // about 110pt of chrome at the top of a form that has to fit a 667pt
      // phone. All four are gone; the back button is not.
      expect(find.text('Step 1 of 2'), findsNothing);
      expect(find.text('Account'), findsNothing);
      expect(find.text('Property'), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.byType(ModernBackButton), findsOneWidget);
    });

    testWidgets('step one is self-explanatory from its button alone',
        (tester) async {
      await open(tester);

      // With no indicator, the button is the only thing saying where in the
      // flow the resident is, so step one must not look final.
      expect(find.text('Continue'), findsOneWidget);
      expect(find.text('Create Account'), findsOneWidget); // the heading
      expect(find.widgetWithText(StagedSubmitButton, 'Create Account'),
          findsNothing);
    });

    testWidgets('opens with the same emblem as sign-in', (tester) async {
      await open(tester);

      expect(find.byType(BrandMark), findsOneWidget);
      // The green tile with a `userPlus` glyph in it is gone — the two halves
      // of the threshold used to open with two different marks.
      expect(find.byIcon(PhosphorIconsFill.userPlus), findsNothing);
    });

    testWidgets('uses the shared capsule fields', (tester) async {
      await open(tester);

      // Full name, email, password, confirm.
      expect(find.byType(AuthField), findsNWidgets(4));
    });

    testWidgets('fits a 375pt viewport without overflowing', (tester) async {
      await open(tester);
      expect(tester.takeException(), isNull);
    });

    testWidgets('each policy is its own tappable link', (tester) async {
      await open(tester);

      // Both policies are named, and separately — one combined
      // "Terms & Privacy Policy" link cannot take you to either of them.
      // `textContaining`, not `text`: these are spans inside one Text.rich,
      // so the widget's plain text is the whole sentence.
      expect(find.textContaining('Terms and Conditions'), findsOneWidget);
      expect(find.textContaining('Privacy Policy'), findsOneWidget);

      // ── THE DEFECT, STATED EXACTLY ──────────────────────────────────
      // The old row painted "Terms & Privacy Policy" in brand green with
      // NO recognizer on the span. It looked like a link, and the tap fell
      // through to the row's GestureDetector — which, once the terms had
      // been read, toggled agreement. Pressing a link to READ a policy
      // silently changed what you had agreed to.
      //
      // Asserted on the span tree rather than by tapping: `tapOnText`
      // cannot find a hit-testable offset here, because the test font is
      // about twice the width of the real one (see the typography notes)
      // and wraps this sentence across three lines. The recognizer is the
      // thing that was missing, so it is the thing to assert.
      final sentence = tester.widget<Text>(
        find.textContaining('Terms and Conditions'),
      );
      final links = <String, bool>{};
      void walk(InlineSpan span) {
        if (span is TextSpan) {
          if (span.text != null && span.recognizer != null) {
            links[span.text!] = true;
          }
          span.children?.forEach(walk);
        }
      }

      walk(sentence.textSpan!);
      expect(links.keys, containsAll(<String>['Terms and Conditions', 'Privacy Policy']));
    });

    testWidgets('the box cannot be ticked before the policies are opened',
        (tester) async {
      await open(tester);

      // The read-first gate. Pressing the row opens the sheet instead of
      // agreeing — this is the one screen where "I agree" is a legal claim
      // about something the resident may not have seen.
      //
      // The caption that used to explain this was removed by request, so
      // the BEHAVIOUR is now the only thing asserting the gate exists.
      // That makes this test the gate's documentation.
      expect(find.textContaining('Open either one to continue'), findsNothing);

      await tester.tap(find.textContaining('I agree to the'));
      await tester.pumpAndSettle();

      expect(find.text('1. Acceptance of Terms'), findsOneWidget);
    });
  });

  group('AuthScaffold and AuthFormPane', () {
    Future<void> openLogin(WidgetTester tester, Size size) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(theme: AppTheme.theme, home: const LoginScreen()),
      );
      await tester.pump();
    }

    testWidgets('centres the flow when it fits the viewport', (tester) async {
      // `Center` inside a plain SingleChildScrollView cannot centre: the
      // scroll view hands it unbounded height, so it collapses to its
      // child and the form sits at the top with every spare pixel below
      // it. AuthFormPane gives the child a minimum height of one viewport
      // first. This asserts the result, not the mechanism.
      await openLogin(tester, const Size(430, 932));

      final column = tester.getRect(
        find.descendant(
          of: find.byType(AuthFormPane),
          matching: find.byType(Column),
        ).first,
      );
      final viewport = tester.getRect(find.byType(AuthFormPane));

      expect(
        column.center.dy,
        moreOrLessEquals(viewport.center.dy, epsilon: 1),
        reason: 'the form should sit on the middle of the viewport',
      );
      // Balanced, not merely centred: the gap above and below should match.
      expect(
        column.top - viewport.top,
        moreOrLessEquals(viewport.bottom - column.bottom, epsilon: 2),
      );
    });

    testWidgets('scrolls instead of centring when it does not fit',
        (tester) async {
      // Same layout, no branch on screen size: once the content is taller
      // than the viewport the minimum height stops binding and Center
      // becomes a no-op.
      await openLogin(tester, const Size(320, 420));

      final pane = tester.widget<SingleChildScrollView>(
        find.descendant(
          of: find.byType(AuthFormPane),
          matching: find.byType(SingleChildScrollView),
        ),
      );
      expect(pane.physics, isNot(isA<NeverScrollableScrollPhysics>()));
      expect(tester.takeException(), isNull);

      final column = tester.getRect(
        find.descendant(
          of: find.byType(AuthFormPane),
          matching: find.byType(Column),
        ).first,
      );
      expect(column.height, greaterThan(420));
    });

    testWidgets('tapping past the fields dismisses the keyboard',
        (tester) async {
      await openLogin(tester, const Size(430, 932));

      await tester.tap(find.byType(TextField).first);
      await tester.pumpAndSettle();
      expect(FocusManager.instance.primaryFocus?.hasFocus, isTrue);

      // The emblem is not a control, so nothing deeper claims this tap and
      // it reaches the scaffold's translucent detector.
      await tester.tapAt(tester.getCenter(find.byType(BrandMark)));
      await tester.pumpAndSettle();

      final focus = FocusManager.instance.primaryFocus;
      expect(focus == null || focus.context?.widget is! EditableText, isTrue);
      expect(find.byType(TextField), findsWidgets);
    });

    testWidgets('a tap on a control still reaches the control',
        (tester) async {
      // `HitTestBehavior.translucent`, not `opaque`: opaque would swallow
      // every tap and leave a screen of dead controls.
      await openLogin(tester, const Size(430, 932));

      await tester.tap(find.byType(TextField).last);
      await tester.pumpAndSettle();
      expect(FocusManager.instance.primaryFocus?.hasFocus, isTrue);
    });
  });

  group('AuthCheckbox', () {
  });

  group('AuthCheckbox parity', () {
    testWidgets('outlines an empty box in gray-300 at 1pt', (tester) async {
      // An UNCHECKED box should be a quiet outline waiting to be filled. It
      // was slate `textMuted` at 1.5pt, which made it the heaviest stroke in
      // its own row — heavier than the capsule fields above it — and put the
      // visual weight on the state that means "not yet".
      await tester.pumpWidget(_host(const AuthCheckbox(checked: false)));
      await tester.pump();

      final box = tester
          .widget<AnimatedContainer>(find.descendant(
            of: find.byType(AuthCheckbox),
            matching: find.byType(AnimatedContainer),
          ))
          .decoration! as BoxDecoration;

      expect(box.border!.top.color, AuthTokens.checkboxBorder);
      expect(box.border!.top.color, const Color(0xFFD1D5DB));
      expect(box.border!.top.width, 1);
      // The weight belongs to the CHECKED state instead.
      expect(box.color, Colors.transparent);
    });

    testWidgets('is 18pt, and the row keeps the touch target', (tester) async {
      // The box is only the picture. 44pt / 48dp governs the TARGET, which
      // is the row around it, so shrinking the square does not shrink the
      // hit area — see the note on AuthCheckbox.
      await tester.pumpWidget(_host(const AuthCheckbox(checked: true)));
      await tester.pump();
      expect(tester.getSize(find.byType(AuthCheckbox)), const Size(18, 18));
    });

    testWidgets('renders one appearance, with no conditional dimming',
        (tester) async {
      // The two screens have shared this class for a while, and it STILL
      // did not look the same on both: sign-up passed `enabled: hasRead`,
      // so an unchecked box read pale slate-200 until the policies were
      // opened while login's read the darker textMuted. Same widget,
      // different picture. The flag is gone; the constructor now takes
      // nothing but `checked`, which is what makes the parity structural
      // rather than a thing to remember.
      await tester.pumpWidget(_host(const Row(
        children: [
          AuthCheckbox(checked: false),
          AuthCheckbox(checked: false),
        ],
      )));
      await tester.pump();

      final boxes = tester
          .widgetList<AnimatedContainer>(
            find.descendant(
              of: find.byType(AuthCheckbox),
              matching: find.byType(AnimatedContainer),
            ),
          )
          .map((c) => c.decoration! as BoxDecoration)
          .toList();

      expect(boxes, hasLength(2));
      expect(boxes[0].border!.top.color, boxes[1].border!.top.color);
      expect(boxes[0].border!.top.width, boxes[1].border!.top.width);
      expect(boxes[0].borderRadius, boxes[1].borderRadius);
      expect(boxes[0].color, boxes[1].color);
      expect(
        tester.getSize(find.byType(AuthCheckbox).first),
        tester.getSize(find.byType(AuthCheckbox).last),
      );
    });
  });

  group('Placeholder tracking', () {
    testWidgets('a password placeholder is not letter-spaced', (tester) async {
      // `InputDecorator` merges the FIELD's style under the decoration's
      // `hintStyle`, so the 2.5pt tracking the obscured capsules use to
      // space their masking dots leaked into their placeholders — while
      // the name and email hints, on unobscured fields, read normally.
      await tester.pumpWidget(_host(Column(children: [
        AuthField(
          label: 'Email',
          controller: TextEditingController(),
          hint: 'name@example.com',
        ),
        AuthField(
          label: 'Password',
          controller: TextEditingController(),
          hint: 'Enter your password',
          obscureText: true,
        ),
      ])));
      await tester.pump();

      final hints = tester
          .widgetList<TextField>(find.byType(TextField))
          .map((f) => f.decoration!.hintStyle!.letterSpacing)
          .toList();

      expect(hints, hasLength(2));
      expect(hints[0], 0, reason: 'the email placeholder');
      expect(hints[1], 0, reason: 'the password placeholder must match it');
      // The FIELD still spaces its masking dots — only the hint is reset.
      final password =
          tester.widgetList<TextField>(find.byType(TextField)).last;
      expect(password.style!.letterSpacing, AppInput.obscuredSpacing);
    });
  });

  group('Token harmonisation', () {
    test('the flow has exactly one green, and it is the deep one', () {
      // `AppColors.primary` (#16A34A) is correct everywhere else in the app
      // and wrong on these two screens: white on it is 3.3:1, and the
      // portals' sign-in uses #047857 for both `--color-brand-500` and
      // `--color-brand-cta`. The Create Account screen carried fourteen
      // references to the lighter green while Login used the deeper one, so
      // the brand changed shade halfway through registering.
      expect(AuthTokens.brand, const Color(0xFF047857));
      expect(AuthTokens.brand, AppColors.brandMarkOnLight);
      // ── THE SPLIT IS CLOSED ──────────────────────────────────────────
      // This used to assert `isNot(AppColors.primary)`, because the app ran
      // on #16A34A while the threshold ran on #047857. `accentPrimary` has
      // been repointed, so one token now serves both — and `headerSurface`,
      // `ctaGreen` and `accent` are aliases of it, which is what made the
      // whole audit a one-line change.
      expect(AuthTokens.brand, AppColors.primary);
      expect(AuthTokens.brand, AppColors.headerSurface);
      expect(AuthTokens.brand, AppColors.ctaGreen);
      // `success` stays #16A34A on purpose: a status colour, not the brand.
      expect(AppColors.success, isNot(AuthTokens.brand));
    });

    test('the hairline is slate, not the emerald glass stroke', () {
      // `AppColors.innerStroke` is emerald-100 at 80% — right for the app's
      // glass surfaces, wrong beside capsule fields outlined in slate.
      expect(AuthTokens.border, const Color(0xCCE2E8F0));
      expect(AuthTokens.border, isNot(AppColors.innerStroke));
    });
  });

  group('HOA directory', () {
    test('carries the finalised numbers, and no placeholders', () {
      // These were `+63 917 123 4567` and `+63 917 765 4321` — numbers
      // plausible enough to ship and reaching nobody, on the screen a
      // resident opens when something is wrong.
      expect(HoaContact.officeNumber, '0966 241 7617');
      expect(HoaContact.mainGateNumber, '0951 280 1347');
      expect(HoaContact.guards.map((g) => g.number), [
        '0945 382 3579',
        '0907 897 0640',
        '0938 155 0006',
      ]);
      expect(HoaContact.guards.map((g) => g.name), [
        'Jonathan Marbebe',
        'Jose Sollano',
        'Wheve Oro',
      ]);
    });

    test('the offline SOS still has a staffed number to text', () {
      // The SMS fallback addressed `hotlineNumber`, which the real directory
      // deleted. Had that gone unnoticed, the one path that exists for "no
      // data at all" would have been texting a dead placeholder.
      expect(SosSmsFallback.recipient, HoaContact.mainGateNumber);
      expect(SosSmsFallback.recipient, isNot(HoaContact.officeNumber));
    });
  });

  group('ConnectivityProbe', () {
    const channel = MethodChannel('dev.fluttercommunity.plus/connectivity');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

    tearDown(() => messenger.setMockMethodCallHandler(channel, null));

    test('reads the platform answer', () async {
      messenger.setMockMethodCallHandler(channel, (call) async => 'wifi');
      expect(await ConnectivityProbe.isOnline(), isTrue);

      messenger.setMockMethodCallHandler(channel, (call) async => 'none');
      expect(await ConnectivityProbe.isOnline(), isFalse);
    });

    test('assumes online when the probe itself fails', () async {
      // The asymmetry this class is built on: only `false` is a firm answer,
      // so a broken probe must never be the thing that makes start-up behave
      // differently.
      messenger.setMockMethodCallHandler(
        channel,
        (call) async => throw PlatformException(code: 'unavailable'),
      );
      expect(await ConnectivityProbe.isOnline(), isTrue);
    });

    test('assumes online when the platform never answers', () async {
      messenger.setMockMethodCallHandler(
        channel,
        (call) => Future<Object?>.delayed(const Duration(seconds: 30)),
      );
      expect(await ConnectivityProbe.isOnline(), isTrue);
    });
  });
}
