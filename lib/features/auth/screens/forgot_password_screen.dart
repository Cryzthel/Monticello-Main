import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
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

  Future<void> _sendOtp() async {
    if (_sending) return;
    if (!_formKey.currentState!.validate()) return;

    setState(() => _sending = true);
    _email = _emailCtrl.text.trim().toLowerCase();

    try {
      final callable = _functions.httpsCallable('sendPasswordOtp');
      await callable.call(<String, dynamic>{'email': _email});

      if (!mounted) return;
      // To avoid account enumeration the backend always succeeds; we always
      // advance to the code screen and let verification decide the outcome.
      setState(() {
        _step = 1;
        _otpCtrl.clear();
      });
      _showToast('If an account exists, a code was sent to $_email');
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted) _otpFocusNode.requestFocus();
      });
    } on FirebaseFunctionsException catch (e) {
      _showToast(e.message ?? 'Could not send verification code.',
          isError: true);
    } catch (_) {
      _showToast('Something went wrong. Please try again.', isError: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verifyOtp() async {
    final entered = _otpCtrl.text;
    if (entered.length < kOtpLength) {
      _showToast('Please enter the full $kOtpLength-digit code.', isError: true);
      return;
    }

    setState(() => _sending = true);

    try {
      final callable = _functions.httpsCallable('verifyPasswordOtp');
      final result = await callable.call(<String, dynamic>{
        'email': _email,
        'otp': entered,
      });

      final link = (result.data as Map?)?['resetLink'] as String?;
      final code = link == null ? null : Uri.parse(link).queryParameters['oobCode'];
      if (code == null || code.isEmpty) {
        _showToast('Verification failed. Please request a new code.',
            isError: true);
        return;
      }

      if (!mounted) return;
      setState(() {
        _resetCode = code;
        _step = 2;
      });
      _showToast('Code verified successfully');
    } on FirebaseFunctionsException catch (e) {
      _showToast(e.message ?? 'Incorrect code. Please try again.',
          isError: true);
      _otpCtrl.clear();
      if (mounted) _otpFocusNode.requestFocus();
    } catch (_) {
      _showToast('Verification failed. Please try again.', isError: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _resetPassword() async {
    if (_sending) return;
    final newPass = _newPassCtrl.text;
    final confirm = _confirmPassCtrl.text;

    if (newPass.length < 8) {
      _showToast('Password must be at least 8 characters.', isError: true);
      return;
    }
    if (newPass != confirm) {
      _showToast('Passwords do not match.', isError: true);
      return;
    }

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

  InputDecoration _inputDecoration({
    required String hint,
    required IconData prefixIcon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: AppColors.bgLight,
      hintStyle: sfPro(fontSize: 14, color: AppColors.textMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      prefixIcon: Icon(prefixIcon, size: 20, color: AppColors.textMuted),
      suffixIcon: suffixIcon,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.divider, width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.divider, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.danger, width: 1),
      ),
    );
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
                      if (_step > 0 && !_sending) {
                        setState(() => _step = _step - 1);
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
              child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 20),

                  // Step indicator
                  _buildStepIndicator(),
                  const SizedBox(height: 32),

                  // Icon
                  Center(
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        borderRadius: BorderRadius.circular(20),
                        // Neutral. This was emerald at 30%, a green halo
                        // pooling under a green tile — the tile already says
                        // "brand"; the shadow only needs to say "raised".
                        boxShadow: AppShadows.md,
                      ),
                      child: Icon(
                        _step == 0
                            ? PhosphorIconsFill.envelopeSimple
                            : _step == 1
                                ? PhosphorIconsFill.pushPinSimple
                                : PhosphorIconsFill.lock,
                        color: AppColors.background,
                        size: 36,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),

                  // Title
                  Text(
                    _step == 0
                        ? 'Reset Password'
                        : _step == 1
                            ? 'Enter Code'
                            : 'New Password',
                    textAlign: TextAlign.center,
                    style: _t(size: 24, weight: FontWeight.w700, letterSpacing: -0.3),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _step == 0
                        ? 'Enter your email and we\'ll send a verification code.'
                        : _step == 1
                            ? 'We sent a $kOtpLength-digit code to $_email'
                            : 'Create a strong new password for your account.',
                    textAlign: TextAlign.center,
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
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
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
          ],
        ),
      ),
    );
  }

  Widget _buildStepIndicator() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(3, (i) {
        final isActive = i == _step;
        final isDone = i < _step;
        return Row(
          children: [
            if (i > 0)
              Container(
                width: 32,
                height: 2,
                color: isDone || isActive
                    ? AppColors.primary
                    : AppColors.innerStroke,
              ),
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isDone
                    ? AppColors.primary
                    : isActive
                        ? AppColors.primary.withValues(alpha: 0.12)
                        : AppColors.innerStroke.withValues(alpha: 0.5),
                border: Border.all(
                  color: isDone || isActive
                      ? AppColors.primary
                      : AppColors.innerStroke,
                  width: 1.5,
                ),
              ),
              child: Center(
                child: isDone
                    ? const Icon(PhosphorIconsFill.check,
                        size: 14, color: AppColors.background)
                    : Text(
                        '${i + 1}',
                        style: _t(
                          size: 12,
                          weight: FontWeight.w700,
                          color: isActive
                              ? AppColors.primary
                              : AppColors.textMuted,
                        ),
                      ),
              ),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildEmailStep() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Email',
              style: _t(size: 13, weight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextFormField(
            controller: _emailCtrl,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _sending ? null : _sendOtp(),
            style: _t(size: 15, weight: AppInput.weight),
            decoration: _inputDecoration(
              hint: 'you@example.com',
              prefixIcon: PhosphorIconsFill.envelopeSimple,
            ),
            validator: (v) =>
                (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
          ),
          const SizedBox(height: 28),
          SizedBox(
            height: 54,
            child: ElevatedButton(
              onPressed: _sending ? null : _sendOtp,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.background,
                disabledBackgroundColor:
                    AppColors.primary.withValues(alpha: 0.5),
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              child: _sending
                  ? const LeafLoader(size: 20, color: AppColors.background)
                  : Text('Send Verification Code',
                      style: _t(
                          size: 15,
                          weight: FontWeight.w600,
                          color: AppColors.background)),
            ),
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
          onCompleted: (_) => _verifyOtp(),
        ),
        const SizedBox(height: 28),
        SizedBox(
          height: 54,
          child: ElevatedButton(
            onPressed: _sending ? null : _verifyOtp,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.background,
              disabledBackgroundColor:
                  AppColors.primary.withValues(alpha: 0.5),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
            child: _sending
                ? const LeafLoader(size: 20, color: AppColors.background)
                : Text('Verify Code',
                    style: _t(
                        size: 15,
                        weight: FontWeight.w600,
                        color: AppColors.background)),
          ),
        ),
        const SizedBox(height: 20),
        Center(
          child: GestureDetector(
            onTap: _sending ? null : _sendOtp,
            child: Text(
              'Didn\'t receive a code? Resend',
              style: _t(
                  size: 13,
                  weight: FontWeight.w600,
                  color: AppColors.primary),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildNewPasswordStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('New Password',
            style: _t(size: 13, weight: FontWeight.w600)),
        const SizedBox(height: 8),
        TextFormField(
          controller: _newPassCtrl,
          obscureText: _obscureNew,
          obscuringCharacter: AppInput.obscuringCharacter,
          style: _t(size: 15, weight: AppInput.weight, letterSpacing: AppInput.obscuredSpacing),
          decoration: _inputDecoration(
            hint: 'At least 8 characters',
            prefixIcon: PhosphorIconsFill.lock,
            suffixIcon: IconButton(
              icon: Icon(
                _obscureNew
                    ? PhosphorIconsFill.eye
                    : PhosphorIconsFill.eyeSlash,
                size: 20,
                color: AppColors.textMuted,
              ),
              onPressed: () => setState(() => _obscureNew = !_obscureNew),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text('Confirm Password',
            style: _t(size: 13, weight: FontWeight.w600)),
        const SizedBox(height: 8),
        TextFormField(
          controller: _confirmPassCtrl,
          obscureText: _obscureConfirm,
          obscuringCharacter: AppInput.obscuringCharacter,
          style: _t(size: 15, weight: AppInput.weight, letterSpacing: AppInput.obscuredSpacing),
          decoration: _inputDecoration(
            hint: 'Re-enter your password',
            prefixIcon: PhosphorIconsFill.lock,
            suffixIcon: IconButton(
              icon: Icon(
                _obscureConfirm
                    ? PhosphorIconsFill.eye
                    : PhosphorIconsFill.eyeSlash,
                size: 20,
                color: AppColors.textMuted,
              ),
              onPressed: () =>
                  setState(() => _obscureConfirm = !_obscureConfirm),
            ),
          ),
        ),
        const SizedBox(height: 28),
        SizedBox(
          height: 54,
          child: ElevatedButton(
            onPressed: _sending ? null : _resetPassword,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.background,
              disabledBackgroundColor:
                  AppColors.primary.withValues(alpha: 0.5),
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
            child: _sending
                ? const LeafLoader(size: 20, color: AppColors.background)
                : Text('Reset Password',
                    style: _t(
                        size: 15,
                        weight: FontWeight.w600,
                        color: AppColors.background)),
          ),
        ),
      ],
    );
  }
}
