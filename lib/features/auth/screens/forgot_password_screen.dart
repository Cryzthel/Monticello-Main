import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:monticello_villas_app/features/auth/services/email_rule.dart';
import 'package:monticello_villas_app/features/auth/services/password_policy.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/auth/widgets/otp_pin_input.dart';

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
  double letterSpacing = 0,
  double height = 1.35,
}) {
  // Plus Jakarta Sans is the single global type family across every platform.
  return sfPro(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _resetFormKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  /// ONE controller holding the whole code, not one per box.
  ///
  /// The four-field version this replaced lost paste, backspace-from-empty and
  /// platform one-time-code autofill — all three because the platform fills and
  /// pastes into a single field, and six `maxLength: 1` fields take the first
  /// character and discard the rest. `OtpPinInput` draws the boxes from this
  /// one field's value, so they cannot disagree with it either.
  final TextEditingController _otpCtrl = TextEditingController();
  final FocusNode _otpFocusNode = FocusNode();
  final _newPassCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();

  bool _sending = false;
  bool _prefilled = false;
  int _step = 0; // 0 = email, 1 = OTP, 2 = new password

  // ── ONE CHANNEL: THE EMAILED CODE ──────────────────────────────────────
  // This screen used to try the code and, when the Cloud Functions behind it
  // could not run, quietly email a reset LINK instead — two different ways
  // to reset, and a resident never knew which one to look for. It is the
  // code only now, by decision. The cost, stated plainly: while the project
  // is not on a billed plan the functions cannot execute, and this screen
  // says so on the email field rather than pretending a mail is coming.

  /// A server answer about the address, shown INSIDE the email field's error
  /// slot so it sits under the input like every other validation message.
  String? _emailError;

  /// The server's answer about a code, shown under the boxes.
  String? _codeError;

  /// Seconds until Resend is allowed again. The function silently ignores a
  /// resend inside 60 seconds — this makes that visible instead of letting a
  /// resident tap a button that does nothing.
  int _resendIn = 0;
  Timer? _resendTimer;
  static const int _resendCooldown = 60;

  String _email = '';
  String _resetCode = ''; // oobCode extracted from the reset link
  bool _obscureNew = true;
  bool _obscureConfirm = true;

  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_prefilled) return;
    _prefilled = true;
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is Map && args['email'] is String) {
      _emailCtrl.text = (args['email'] as String).trim();
    }
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _emailCtrl.dispose();
    _otpCtrl.dispose();
    _otpFocusNode.dispose();
    _newPassCtrl.dispose();
    _confirmPassCtrl.dispose();
    super.dispose();
  }

  void _showToast(String message, {bool isError = false}) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        content: Row(
          children: [
            Icon(
              isError
                  ? PhosphorIconsFill.warningCircle
                  : PhosphorIconsFill.checkCircle,
              color: AppColors.background,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: sfPro(
                    fontSize: 14,
                    color: AppColors.background,
                    fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Callable failures that mean the function never executed, as opposed to
  /// the function answering "no".
  static const _backendDown = {
    'internal',
    'unavailable',
    'deadline-exceeded',
    'not-found',
  };

  static const _unavailableMessage =
      'Password reset is unavailable right now. Please try again later, '
      'or contact the HOA office.';

  void _startResendCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendIn = _resendCooldown);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn = (_resendIn - 1).clamp(0, _resendCooldown));
      if (_resendIn == 0) t.cancel();
    });
  }

  /// Shows [message] under the email field, through its own validator.
  void _showEmailError(String message) {
    if (!mounted) return;
    setState(() => _emailError = message);
    _formKey.currentState?.validate();
  }

  bool get _emailLooksValid => EmailRule.validate(_emailCtrl.text) == null;

  /// Step one's button. Validates the address, then sends.
  Future<void> _sendOtp() async {
    if (_sending || !_emailLooksValid) return;
    setState(() => _emailError = null);
    if (!(_formKey.currentState?.validate() ?? false)) return;
    _email = EmailRule.normalize(_emailCtrl.text);
    await _deliverCode(resend: false);
  }

  /// "Resend code" on step two. There is no email form on that step — the
  /// old handler validated it anyway, through a null form key, and threw.
  Future<void> _resendOtp() async {
    if (_sending || _resendIn > 0 || _email.isEmpty) return;
    await _deliverCode(resend: true);
  }

  Future<void> _deliverCode({required bool resend}) async {
    setState(() => _sending = true);
    try {
      final callable = _functions.httpsCallable('sendPasswordOtp');
      await callable.call(<String, dynamic>{'email': _email});
      if (!mounted) return;

      // Reaching here means the account exists: an unregistered address is
      // refused by the function (see below), by the estate's decision.
      setState(() {
        _step = 1;
        _codeError = null;
        _otpCtrl.clear();
      });
      _startResendCooldown();
      if (resend) _showToast('A new code is on its way.');
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted) _otpFocusNode.requestFocus();
      });
    } on FirebaseFunctionsException catch (e) {
      final details = e.details;
      if (details is Map && details['reason'] == 'not-registered') {
        const message = 'This email address is not registered.';
        resend ? _showToast(message, isError: true) : _showEmailError(message);
        return;
      }
      final message = _backendDown.contains(e.code)
          ? _unavailableMessage
          : e.code == 'invalid-argument'
              ? 'Enter a valid email address, like name@example.com.'
              : (e.message ?? 'Could not send a code. Please try again.');
      resend ? _showToast(message, isError: true) : _showEmailError(message);
    } catch (_) {
      const message = 'Something went wrong. Please try again.';
      resend ? _showToast(message, isError: true) : _showEmailError(message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verifyOtp() async {
    // The boxes submit on the last digit AND the button submits on a tap;
    // without this a quick resident sends one code twice and spends two of
    // the five attempts.
    if (_sending) return;
    final entered = _otpCtrl.text;
    if (entered.length < kOtpLength) {
      setState(() => _codeError = 'Enter all $kOtpLength digits.');
      return;
    }

    setState(() {
      _sending = true;
      _codeError = null;
    });

    var refocus = false;
    try {
      final callable = _functions.httpsCallable('verifyPasswordOtp');
      final result = await callable.call(<String, dynamic>{
        'email': _email,
        'otp': entered,
      });

      final link = (result.data as Map?)?['resetLink'] as String?;
      final code = link == null ? null : Uri.parse(link).queryParameters['oobCode'];
      if (code == null || code.isEmpty) {
        if (mounted) {
          setState(() =>
              _codeError = 'Verification failed. Please request a new code.');
        }
        return;
      }

      if (!mounted) return;
      // No "verified" toast: the screen turning into New Password says it.
      setState(() {
        _resetCode = code;
        _step = 2;
      });
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;
      setState(() {
        _codeError = _backendDown.contains(e.code) && e.code != 'not-found'
            ? _unavailableMessage
            : (e.message ?? 'Incorrect code. Please try again.');
      });
      _otpCtrl.clear();
      refocus = true;
    } catch (_) {
      if (mounted) {
        setState(() => _codeError = 'Verification failed. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
      // ── AFTER THE BOXES ARE ENABLED AGAIN ───────────────────────────────
      // This asked for focus while the field was still disabled for the
      // request, which a disabled field refuses — so a wrong code closed the
      // keyboard and the resident had to tap the boxes to try again.
      if (refocus) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _otpFocusNode.requestFocus();
        });
      }
    }
  }

  Future<void> _resetPassword() async {
    if (_sending) return;
    final newPass = _newPassCtrl.text;
    final confirm = _confirmPassCtrl.text;

    // Was a length check alone, so the recovery flow accepted passwords
    // registration refuses. Same three rules as sign-up now, reported on the
    // field that broke them rather than in a toast.
    if (!(_resetFormKey.currentState?.validate() ?? false)) return;
    if (!PasswordPolicy.isStrong(newPass) || newPass != confirm) return;

    setState(() => _sending = true);

    try {
      await FirebaseAuth.instance.confirmPasswordReset(
        code: _resetCode,
        newPassword: newPass,
      );

      if (!mounted) return;
      _showToast('Password updated. You can now sign in.');
      await Future.delayed(const Duration(seconds: 1));
      if (mounted) Navigator.of(context).pop();
    } on FirebaseAuthException catch (e) {
      _showToast(e.message ?? 'Could not reset password. Try again.',
          isError: true);
    } catch (_) {
      _showToast('Could not reset password. Try again.', isError: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgLight,
      body: SafeArea(
        child: Column(
          children: [
            // Standard app-wide back-button header — matches the incident
            // report flow's header exactly instead of an AppBar leading.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  ModernBackButton(
                    onPressed: () {
                      if (_sending) return;
                      if (_step > 0) {
                        // Back to the address from either later step. From
                        // the new-password step the code is already spent,
                        // so the code screen would be a dead end.
                        setState(() => _step = 0);
                      } else {
                        Navigator.of(context).maybePop();
                      }
                    },
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Forgot Password',
                      style: _t(size: 18, weight: FontWeight.w700, letterSpacing: -0.3),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: DismissKeyboardOnTap(
                child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 20),

                  // ── NO RAIL, NO TILE ──────────────────────────────────
                  // Two things came off the top of this screen: a three-dot
                  // step rail, and a 72px green square holding a glyph that
                  // changed per step (envelope, pin, padlock).
                  //
                  // The tile is the last of the stand-in icon plates — the
                  // splash, both auth headers and the onboarding hero have
                  // all given theirs up — and it was the largest, loudest
                  // thing on a screen whose job is to ask for one email
                  // address.
                  //
                  // The rail is a deliberate trade, and the honest version
                  // is: guidance says a multi-step process should indicate
                  // progress, and removing it gives that up. What covers it
                  // is that each step RENAMES the screen — "Reset Password",
                  // then "Enter Code", then "New Password" — with a subtitle
                  // restating what is being asked and a working back arrow.
                  // Three dots above three differently-titled screens were
                  // telling the reader a fourth time.

                  // Title
                  Text(
                    _step == 0
                            ? 'Reset Password'
                        : _step == 1
                            ? 'Enter Code'
                            : 'New Password',
                    textAlign: TextAlign.start,
                    style: _t(size: 24, weight: FontWeight.w700, letterSpacing: -0.3),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _step == 0
                        ? 'Enter your email and we\'ll send a $kOtpLength-digit '
                            'code to reset your password.'
                        : _step == 1
                            ? 'We sent a $kOtpLength-digit code to $_email. '
                                'It expires in 10 minutes.'
                            : 'Create a strong new password for your account.',
                    textAlign: TextAlign.start,
                    style: _t(
                        size: 14, color: AppColors.textSecondary, height: 1.5),
                  ),
                  const SizedBox(height: 36),

                  // Step content
                  if (_step == 0) _buildEmailStep(),
                  if (_step == 1) _buildOtpStep(),
                  if (_step == 2) _buildNewPasswordStep(),

                  const SizedBox(height: 40),

                  if (_step == 0)
                    Wrap(
                      alignment: WrapAlignment.center,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text('Remember your password? ',
                            style: _t(size: 14, color: AppColors.textSecondary)),
                        GestureDetector(
                          onTap: _sending
                              ? null
                              : () => Navigator.of(context).maybePop(),
                          child: Text(
                            'Back to Login',
                            style: _t(
                                size: 14,
                                color: AppColors.primary,
                                weight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  // ── THE SAME FIELDS AND BUTTON AS SIGN-IN ──────────────────────────────
  // This screen had its own inputs: square-cornered, a 54pt button, a static
  // label above each box and a padlock or envelope inside it. It is reached
  // FROM the sign-in screen, so the resident saw the form change kit between
  // one tap and the next. AuthField and AuthButton make it the same form.

  Widget _buildEmailStep() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthField(
            label: 'Email',
            controller: _emailCtrl,
            hint: 'name@example.com',
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            onSubmitted: (_) => _sending || !_emailLooksValid ? null : _sendOtp(),
            // ── ONE MESSAGE UNDER THIS FIELD, AND ONLY FROM THE SERVER ──────
            // The format line ("Enter a valid email address, like…") is gone
            // by request. A half-typed address is answered by the button
            // staying disabled until it looks like one; the only red text
            // here is what the server said — chiefly "This email address is
            // not registered."
            validator: (_) => _emailError,
            onChanged: (_) => setState(() => _emailError = null),
          ),
          const SizedBox(height: 28),
          AuthButton(
            label: 'Send Code',
            busy: _sending,
            onPressed: _sending || !_emailLooksValid ? null : _sendOtp,
          ),
        ],
      ),
    );
  }

  Widget _buildOtpStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OtpPinInput(
          controller: _otpCtrl,
          focusNode: _otpFocusNode,
          enabled: !_sending,
          hasError: _codeError != null,
          onChanged: (_) {
            if (_codeError != null) setState(() => _codeError = null);
          },
          onCompleted: (_) => _verifyOtp(),
        ),
        // A fixed two-line slot, so an error appearing under the boxes does
        // not push the button down while a thumb is on its way to it.
        SizedBox(
          height: 44,
          child: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Semantics(
              liveRegion: true,
              child: Text(
                _codeError ?? '',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: _t(
                    size: 12.5,
                    weight: FontWeight.w600,
                    color: AppColors.danger),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        AuthButton(
          label: 'Verify Code',
          busy: _sending,
          onPressed: _sending ? null : _verifyOtp,
        ),
        const SizedBox(height: 20),
        Center(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _sending || _resendIn > 0 ? null : _resendOtp,
            child: Padding(
              // 44pt tall: this was a bare line of 13pt text.
              padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 8),
              child: Text(
                _resendIn > 0
                    ? 'Resend code in 0:${_resendIn.toString().padLeft(2, '0')}'
                    : 'Didn\'t receive a code? Resend',
                style: _t(
                    size: 13,
                    weight: FontWeight.w600,
                    color: _resendIn > 0
                        ? AppColors.textMuted
                        : AppColors.primary),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNewPasswordStep() {
    return Form(
      key: _resetFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthField(
            label: 'New Password',
            controller: _newPassCtrl,
            hint: 'At least 8 characters',
            obscureText: _obscureNew,
            autocorrect: false,
            textInputAction: TextInputAction.next,
            autofillHints: const [AutofillHints.newPassword],
            trailing: _RevealToggle(
              obscured: _obscureNew,
              onTap: () => setState(() => _obscureNew = !_obscureNew),
            ),
            validator: (v) {
              if (v.isEmpty) return 'Enter a new password';
              if (!PasswordPolicy.isStrong(v)) {
                return 'Password requirements not met';
              }
              return null;
            },
          ),
          const SizedBox(height: 16),
          AuthField(
            label: 'Confirm Password',
            controller: _confirmPassCtrl,
            hint: 'Re-enter your password',
            obscureText: _obscureConfirm,
            autocorrect: false,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.newPassword],
            trailing: _RevealToggle(
              obscured: _obscureConfirm,
              onTap: () => setState(() => _obscureConfirm = !_obscureConfirm),
            ),
            onSubmitted: (_) => _sending ? null : _resetPassword(),
            validator: (v) =>
                v != _newPassCtrl.text ? 'Passwords do not match' : null,
          ),
          const SizedBox(height: 28),
          AuthButton(
            label: 'Reset Password',
            busy: _sending,
            onPressed: _sending ? null : _resetPassword,
          ),
        ],
      ),
    );
  }
}

/// The eye in a password capsule — the same control sign-up and Change
/// Password use, sized to the 48pt capsule rather than Material's larger
/// IconButton.
class _RevealToggle extends StatelessWidget {
  const _RevealToggle({required this.obscured, required this.onTap});

  final bool obscured;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
        child: Icon(
          obscured ? PhosphorIconsFill.eyeSlash : PhosphorIconsFill.eye,
          size: 20,
          color: AppColors.textMuted,
        ),
      ),
    );
  }
}
