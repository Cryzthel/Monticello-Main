import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/auth/widgets/otp_pin_input.dart';

/// The reset-code field, which is one real TextField drawn as one box per digit.
///
/// The tests below are all about that seam. Everything a resident does to this
/// control — pasting a code out of an email, correcting a digit, having the
/// platform fill it from a notification — arrives as a change on the single
/// controller, and the boxes have to agree with it. The six-separate-fields
/// version this replaced failed exactly these cases, so they are the ones
/// worth pinning down.
/// A code of exactly [kOtpLength] digits, and its "one digit corrected" twin.
final String _code = '418302'.substring(0, kOtpLength);
final String _corrected =
    _code.substring(0, kOtpLength - 1) + (_code.endsWith('9') ? '0' : '9');

void main() {
  late TextEditingController controller;

  setUp(() => controller = TextEditingController());
  tearDown(() => controller.dispose());

  Future<void> pump(
    WidgetTester tester, {
    ValueChanged<String>? onCompleted,
    bool enabled = true,
    bool hasError = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: OtpPinInput(
            controller: controller,
            enabled: enabled,
            hasError: hasError,
            autofocus: false,
            onCompleted: onCompleted,
          ),
        ),
      ),
    );
    await tester.pump();
  }

  /// The visible boxes, which are the AnimatedContainers the digits sit in.
  Finder boxes() => find.byType(AnimatedContainer);

  testWidgets('draws one box per digit of the code', (tester) async {
    await pump(tester);
    expect(boxes(), findsNWidgets(kOtpLength));
  });

  testWidgets('fills the boxes left to right as digits arrive',
      (tester) async {
    await pump(tester);

    await tester.enterText(find.byType(TextField), '41');
    await tester.pump();

    expect(find.text('4'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    // Nothing has been invented for the boxes that are still empty.
    expect(find.text('0'), findsNothing);
  });

  testWidgets('a pasted code fills every box and completes in one step',
      (tester) async {
    final completed = <String>[];
    await pump(tester, onCompleted: completed.add);

    // What a paste looks like to the field: the whole string at once. The
    // six-field version turned this into a single "4" and dropped the rest.
    await tester.enterText(find.byType(TextField), _code);
    await tester.pump();

    expect(completed, [_code]);
    for (final digit in _code.split('')) {
      expect(find.text(digit), findsWidgets, reason: 'expected $digit on screen');
    }
  });

  testWidgets('a code pasted with the words around it keeps only the digits',
      (tester) async {
    final completed = <String>[];
    await pump(tester, onCompleted: completed.add);

    // A resident selecting a code out of an email rarely selects only the
    // code. Spaces, dashes and stray letters must not become a wrong code.
    final spaced =
        'is ${_code.substring(0, 2)}-${_code.substring(2)}';
    await tester.enterText(find.byType(TextField), spaced);
    await tester.pump();

    expect(controller.text, _code);
    expect(completed, [_code]);
  });

  testWidgets('extra digits past the code length are refused', (tester) async {
    await pump(tester);

    await tester.enterText(find.byType(TextField), '${_code}1234');
    await tester.pump();

    expect(controller.text.length, kOtpLength);
    expect(controller.text, _code);
  });

  testWidgets('completion fires once, not on every later rebuild',
      (tester) async {
    var calls = 0;
    await pump(tester, onCompleted: (_) => calls++);

    await tester.enterText(find.byType(TextField), _code);
    await tester.pump();
    expect(calls, 1);

    // Rebuilds, focus changes and stray notifications must not re-submit. The
    // callable counts attempts and only allows five, so a double submit burns
    // two of them before the resident has done anything wrong.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(calls, 1);
  });

  testWidgets('correcting a digit re-arms completion', (tester) async {
    final completed = <String>[];
    await pump(tester, onCompleted: completed.add);

    await tester.enterText(find.byType(TextField), _code);
    await tester.pump();
    expect(completed, [_code]);

    // The server said no; the resident deletes a digit and types another.
    await tester.enterText(
        find.byType(TextField), _code.substring(0, kOtpLength - 1));
    await tester.pump();
    await tester.enterText(find.byType(TextField), _corrected);
    await tester.pump();

    expect(completed, [_code, _corrected],
        reason: 'a corrected code has to be submittable');
  });

  test('reset codes are four digits, matching the function', () {
    // OTP_LENGTH in functions/index.js. A mismatch fails every reset.
    expect(kOtpLength, 4);
  });

  testWidgets('a disabled field cannot be changed', (tester) async {
    await pump(tester, enabled: false);

    expect(
      tester.widget<TextField>(find.byType(TextField)).enabled,
      isFalse,
      reason: 'digits must not move under a verification already in flight',
    );
  });

  testWidgets('the field asks the platform for a one-time code',
      (tester) async {
    await pump(tester);

    // This hint is the whole reason the control is one field rather than six:
    // iOS and Android fill ONE field from the notification shade.
    expect(
      tester.widget<TextField>(find.byType(TextField)).autofillHints,
      contains(AutofillHints.oneTimeCode),
    );
  });
}
