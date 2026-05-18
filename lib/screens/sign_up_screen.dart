import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/account_approval_service.dart';
import '../services/firebase_bootstrap.dart';
import '../services/property_storage.dart';
import '../services/theme_mode_controller.dart';
import '../theme/app_theme.dart';

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen>
    with SingleTickerProviderStateMixin {
  // ── Step tracking ──────────────────────────────────────────────────────────
  int _step = 0; // 0 = credentials, 1 = property

  // ── Step 1 state ──────────────────────────────────────────────────────────
  final _formKey = GlobalKey<FormState>();
  final _fullNameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _agreedToTerms = false;
  bool _hasMinLength = false;
  bool _hasNumber = false;
  bool _hasSpecial = false;
  bool _wasEmpty = true;

  // ── Step 2 state ──────────────────────────────────────────────────────────
  String? _phase;
  String? _block;
  String? _lot;

  // ── Shared state ──────────────────────────────────────────────────────────
  bool _loading = false;

  static const _phases = ['1', '2', '3', '4', '5'];
  static const _blocks = ['1', '2', '3', '4', '5', '6', '7', '8'];
  static const _lots = ['01', '02', '03', '04', '05', '06', '07', '08'];

  // ── Local color tokens (light-mode focused, dark-aware via theme) ──────────
  static const _maroon = AppColors.primary;
  static const _green = AppColors.ctaGreen;
  static const _danger = AppColors.danger;
  static const _success = AppColors.success;

  @override
  void initState() {
    super.initState();
    _passwordCtrl.addListener(_onPasswordChanged);
  }

  @override
  void dispose() {
    _passwordCtrl.removeListener(_onPasswordChanged);
    _fullNameCtrl.dispose();
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _confirmCtrl.dispose();
    super.dispose();
  }

  void _onPasswordChanged() {
    final v = _passwordCtrl.text;
    final minLen = v.length >= 8;
    final num = v.contains(RegExp(r'\d'));
    final special =
        v.contains(RegExp(r'[!@#$%^&*(),.?":{}|<>_\-\\/\[\]`~+=;]'));
    final empty = v.isEmpty;
    if (minLen != _hasMinLength ||
        num != _hasNumber ||
        special != _hasSpecial ||
        empty != _wasEmpty) {
      setState(() {
        _hasMinLength = minLen;
        _hasNumber = num;
        _hasSpecial = special;
        _wasEmpty = empty;
      });
    }
  }

  double get _strengthScore {
    var s = 0.0;
    if (_hasMinLength) s += 0.34;
    if (_hasNumber) s += 0.33;
    if (_hasSpecial) s += 0.33;
    return s.clamp(0.0, 1.0);
  }

  Color get _strengthColor {
    if (_strengthScore >= 0.95) return _success;
    if (_strengthScore >= 0.6) return AppColors.warning;
    return _danger;
  }

  bool get _canProceedToStep2 =>
      _formKey.currentState?.validate() == true && _agreedToTerms;

  bool get _canSubmit => _phase != null && _block != null && _lot != null;

  // ── Navigation ────────────────────────────────────────────────────────────

  void _goToStep2() {
    if (!_formKey.currentState!.validate()) return;
    if (!_agreedToTerms) {
      _toast('Please agree to the Terms and Privacy Policy.', isError: true);
      return;
    }
    setState(() => _step = 1);
  }

  void _goBack() {
    if (_step == 0) {
      Navigator.of(context).maybePop();
    } else {
      setState(() => _step = 0);
    }
  }

  // ── Account creation ──────────────────────────────────────────────────────

  Future<void> _createAccount() async {
    if (_loading || !_canSubmit) return;
    if (!firebaseAppReady) {
      _toast('Firebase is not ready. Restart and try again.', isError: true);
      return;
    }

    final fullName = _fullNameCtrl.text.trim();
    final email = _emailCtrl.text.trim();
    final password = _passwordCtrl.text;

    setState(() => _loading = true);
    try {
      final cred = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      final user = cred.user ?? FirebaseAuth.instance.currentUser;
      if (user != null) {
        await _finishSignUp(user: user, fullName: fullName, email: email);
        return;
      }
      _toast('Could not create account. Try again.', isError: true);
    } on FirebaseAuthException catch (e) {
      final maybe = FirebaseAuth.instance.currentUser;
      if (maybe != null) {
        await _finishSignUp(user: maybe, fullName: fullName, email: email);
        return;
      }
      _toast(_authError(e), isError: true);
    } catch (_) {
      final maybe = FirebaseAuth.instance.currentUser;
      if (maybe != null) {
        await _finishSignUp(user: maybe, fullName: fullName, email: email);
        return;
      }
      _toast('Could not create account. Try again.', isError: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _finishSignUp({
    required User user,
    required String fullName,
    required String email,
  }) async {
    if (fullName.isNotEmpty) {
      try {
        await user.updateDisplayName(fullName);
      } catch (_) {}
    }

    // Save property data collected in Step 2
    try {
      await PropertyStorage.saveVerifiedProperty(
        uid: user.uid,
        phase: _phase!,
        block: _block!,
        lot: _lot!,
      );
    } catch (_) {}

    if (!mounted) return;
    await ThemeModeController.instance.loadForUser(user.uid);
    if (!mounted) return;
    _toast('Account created! Welcome to Monticello Villas.');
    Navigator.of(context)
        .pushNamedAndRemoveUntil('/home', (_) => false);

    Future.microtask(() async {
      try {
        await AccountApprovalService.markPending(
          uid: user.uid,
          email: email,
          source: 'email_password',
        );
      } catch (_) {}
    });
  }

  String _authError(FirebaseAuthException e) {
    switch (e.code) {
      case 'email-already-in-use':
        return 'This email is already registered.';
      case 'invalid-email':
        return 'Please enter a valid email address.';
      case 'weak-password':
        return 'Password is too weak.';
      case 'network-request-failed':
        return 'Check your internet connection and try again.';
      default:
        return e.message ?? 'Could not create account.';
    }
  }

  void _toast(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        backgroundColor: isError ? _danger : _success,
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        content: Row(
          children: [
            Icon(
              isError ? Icons.error_outline : Icons.check_circle_outline,
              color: Colors.white,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: GoogleFonts.inter(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.white),
              ),
            ),
          ],
        ),
      ));
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.midnightBase : const Color(0xFFF8F9FA);
    final surface =
        isDark ? AppColors.midnightSurface : Colors.white;
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
    final borderColor =
        isDark ? AppColors.innerStroke : const Color(0xFFE9ECEF);
    final fillColor =
        isDark ? AppColors.midnightInputFill : Colors.white;

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: Column(
          children: [
            // ── Header ──────────────────────────────────────────────
            _StepHeader(
              step: _step,
              totalSteps: 2,
              onBack: _goBack,
              isDark: isDark,
              textPrimary: textPrimary,
            ),

            // ── Body ────────────────────────────────────────────────
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 320),
                switchInCurve: Curves.fastOutSlowIn,
                switchOutCurve: Curves.fastOutSlowIn,
                transitionBuilder: (child, anim) => SlideTransition(
                  position: Tween<Offset>(
                    begin: Offset(_step == 0 ? -0.04 : 0.04, 0),
                    end: Offset.zero,
                  ).animate(anim),
                  child: FadeTransition(opacity: anim, child: child),
                ),
                child: _step == 0
                    ? _CredentialsStep(
                        key: const ValueKey('step0'),
                        formKey: _formKey,
                        fullNameCtrl: _fullNameCtrl,
                        emailCtrl: _emailCtrl,
                        passwordCtrl: _passwordCtrl,
                        confirmCtrl: _confirmCtrl,
                        obscurePassword: _obscurePassword,
                        obscureConfirm: _obscureConfirm,
                        agreedToTerms: _agreedToTerms,
                        hasMinLength: _hasMinLength,
                        hasNumber: _hasNumber,
                        hasSpecial: _hasSpecial,
                        wasEmpty: _wasEmpty,
                        strengthScore: _strengthScore,
                        strengthColor: _strengthColor,
                        isDark: isDark,
                        surface: surface,
                        textPrimary: textPrimary,
                        textSecondary: textSecondary,
                        borderColor: borderColor,
                        fillColor: fillColor,
                        onTogglePassword: () =>
                            setState(() => _obscurePassword = !_obscurePassword),
                        onToggleConfirm: () =>
                            setState(() => _obscureConfirm = !_obscureConfirm),
                        onToggleTerms: (v) =>
                            setState(() => _agreedToTerms = v ?? false),
                        onContinue: _goToStep2,
                        onLogin: () => Navigator.of(context)
                            .pushReplacementNamed('/login'),
                      )
                    : _PropertyStep(
                        key: const ValueKey('step1'),
                        phase: _phase,
                        block: _block,
                        lot: _lot,
                        phases: _phases,
                        blocks: _blocks,
                        lots: _lots,
                        isDark: isDark,
                        surface: surface,
                        textPrimary: textPrimary,
                        textSecondary: textSecondary,
                        borderColor: borderColor,
                        loading: _loading,
                        canSubmit: _canSubmit,
                        onSelectPhase: (v) => setState(() => _phase = v),
                        onSelectBlock: (v) => setState(() => _block = v),
                        onSelectLot: (v) => setState(() => _lot = v),
                        onSubmit: _createAccount,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Step header component ──────────────────────────────────────────────────────

class _StepHeader extends StatelessWidget {
  final int step;
  final int totalSteps;
  final VoidCallback onBack;
  final bool isDark;
  final Color textPrimary;

  const _StepHeader({
    required this.step,
    required this.totalSteps,
    required this.onBack,
    required this.isDark,
    required this.textPrimary,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 24, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: onBack,
                icon: Icon(Icons.arrow_back_ios_new_rounded,
                    color: textPrimary, size: 18),
              ),
              const Spacer(),
              Text(
                'Step ${step + 1} of $totalSteps',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: isDark
                      ? AppColors.textSecondaryOnDark
                      : AppColors.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: LinearProgressIndicator(
                value: (step + 1) / totalSteps,
                minHeight: 4,
                backgroundColor: isDark
                    ? AppColors.midnightSurfaceElevated
                    : const Color(0xFFE9ECEF),
                valueColor: const AlwaysStoppedAnimation<Color>(
                    AppColors.ctaGreen),
              ),
            ),
          ),
          const SizedBox(height: 4),
        ],
      ),
    );
  }
}

// ── Step 1: Credentials ────────────────────────────────────────────────────────

class _CredentialsStep extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController fullNameCtrl;
  final TextEditingController emailCtrl;
  final TextEditingController passwordCtrl;
  final TextEditingController confirmCtrl;
  final bool obscurePassword;
  final bool obscureConfirm;
  final bool agreedToTerms;
  final bool hasMinLength;
  final bool hasNumber;
  final bool hasSpecial;
  final bool wasEmpty;
  final double strengthScore;
  final Color strengthColor;
  final bool isDark;
  final Color surface;
  final Color textPrimary;
  final Color textSecondary;
  final Color borderColor;
  final Color fillColor;
  final VoidCallback onTogglePassword;
  final VoidCallback onToggleConfirm;
  final ValueChanged<bool?> onToggleTerms;
  final VoidCallback onContinue;
  final VoidCallback onLogin;

  const _CredentialsStep({
    super.key,
    required this.formKey,
    required this.fullNameCtrl,
    required this.emailCtrl,
    required this.passwordCtrl,
    required this.confirmCtrl,
    required this.obscurePassword,
    required this.obscureConfirm,
    required this.agreedToTerms,
    required this.hasMinLength,
    required this.hasNumber,
    required this.hasSpecial,
    required this.wasEmpty,
    required this.strengthScore,
    required this.strengthColor,
    required this.isDark,
    required this.surface,
    required this.textPrimary,
    required this.textSecondary,
    required this.borderColor,
    required this.fillColor,
    required this.onTogglePassword,
    required this.onToggleConfirm,
    required this.onToggleTerms,
    required this.onContinue,
    required this.onLogin,
  });

  InputDecoration _field({
    required String hint,
    required IconData icon,
    Widget? suffix,
  }) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: fillColor,
      hintStyle: GoogleFonts.inter(
          fontSize: 14, color: AppColors.textMuted),
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 20, vertical: 17),
      prefixIcon: Icon(icon, size: 19, color: AppColors.textMuted),
      suffixIcon: suffix,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: BorderSide(color: borderColor),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: BorderSide(color: borderColor, width: 1.2),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide:
            const BorderSide(color: AppColors.ctaGreen, width: 1.8),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide:
            const BorderSide(color: AppColors.danger, width: 1.2),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide:
            const BorderSide(color: AppColors.danger, width: 1.8),
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text,
          style: GoogleFonts.inter(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            color: textPrimary,
          ),
        ),
      );

  Widget _requirement(String text, bool ok) => Padding(
        padding: const EdgeInsets.only(top: 6, left: 4),
        child: Row(
          children: [
            Icon(
              ok ? Icons.check_circle_rounded : Icons.circle_outlined,
              size: 15,
              color: ok ? AppColors.success : AppColors.textMuted,
            ),
            const SizedBox(width: 8),
            Text(
              text,
              style: GoogleFonts.inter(
                fontSize: 12.5,
                color: ok ? textPrimary : textSecondary,
                fontWeight:
                    ok ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 40),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              // ── Hero icon ─────────────────────────────────────────
              Center(
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withOpacity(0.38),
                        blurRadius: 22,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.person_add_rounded,
                      color: Colors.white, size: 30),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Create Account',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: textPrimary,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Set up your credentials to get started.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                    fontSize: 14, color: textSecondary),
              ),
              const SizedBox(height: 32),

              Form(
                key: formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _label('Full Name'),
                    TextFormField(
                      controller: fullNameCtrl,
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.words,
                      style: GoogleFonts.inter(
                          fontSize: 15, color: textPrimary),
                      decoration: _field(
                        hint: 'Juan dela Cruz',
                        icon: Icons.person_outline_rounded,
                      ),
                      validator: (v) =>
                          (v == null || v.trim().length < 2)
                              ? 'Enter your full name'
                              : null,
                    ),
                    const SizedBox(height: 18),
                    _label('Email Address'),
                    TextFormField(
                      controller: emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      style: GoogleFonts.inter(
                          fontSize: 15, color: textPrimary),
                      decoration: _field(
                        hint: 'you@example.com',
                        icon: Icons.email_outlined,
                      ),
                      validator: (v) =>
                          (v == null || !v.contains('@'))
                              ? 'Enter a valid email'
                              : null,
                    ),
                    const SizedBox(height: 18),
                    _label('Password'),
                    TextFormField(
                      controller: passwordCtrl,
                      obscureText: obscurePassword,
                      textInputAction: TextInputAction.next,
                      style: GoogleFonts.inter(
                          fontSize: 15, color: textPrimary),
                      decoration: _field(
                        hint: '••••••••',
                        icon: Icons.lock_outline_rounded,
                        suffix: Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: IconButton(
                            onPressed: onTogglePassword,
                            icon: Icon(
                              obscurePassword
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                              size: 19,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ),
                      ),
                      validator: (v) {
                        if (v == null || v.isEmpty) {
                          return 'Enter a password';
                        }
                        if (!hasMinLength || !hasNumber || !hasSpecial) {
                          return 'Password requirements not met';
                        }
                        return null;
                      },
                    ),

                    // Password strength indicator
                    AnimatedSize(
                      duration: const Duration(milliseconds: 260),
                      curve: Curves.fastOutSlowIn,
                      child: wasEmpty
                          ? const SizedBox(width: double.infinity)
                          : Padding(
                              padding: const EdgeInsets.only(top: 14),
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.stretch,
                                children: [
                                  ClipRRect(
                                    borderRadius:
                                        BorderRadius.circular(AppRadius.pill),
                                    child: LinearProgressIndicator(
                                      value: strengthScore,
                                      minHeight: 5,
                                      backgroundColor: isDark
                                          ? AppColors.midnightSurfaceElevated
                                          : const Color(0xFFE9ECEF),
                                      valueColor:
                                          AlwaysStoppedAnimation<Color>(
                                              strengthColor),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  _requirement(
                                      'At least 8 characters', hasMinLength),
                                  _requirement(
                                      'At least one number', hasNumber),
                                  _requirement(
                                      'At least one special character',
                                      hasSpecial),
                                ],
                              ),
                            ),
                    ),
                    const SizedBox(height: 18),
                    _label('Confirm Password'),
                    TextFormField(
                      controller: confirmCtrl,
                      obscureText: obscureConfirm,
                      textInputAction: TextInputAction.done,
                      style: GoogleFonts.inter(
                          fontSize: 15, color: textPrimary),
                      decoration: _field(
                        hint: '••••••••',
                        icon: Icons.lock_outline_rounded,
                        suffix: Padding(
                          padding: const EdgeInsets.only(right: 4),
                          child: IconButton(
                            onPressed: onToggleConfirm,
                            icon: Icon(
                              obscureConfirm
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                              size: 19,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ),
                      ),
                      validator: (v) =>
                          v != passwordCtrl.text
                              ? 'Passwords do not match'
                              : null,
                    ),
                    const SizedBox(height: 22),

                    // Terms checkbox
                    GestureDetector(
                      onTap: () => onToggleTerms(!agreedToTerms),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          SizedBox(
                            width: 22,
                            height: 22,
                            child: Checkbox(
                              value: agreedToTerms,
                              activeColor: AppColors.primary,
                              checkColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(5)),
                              side: const BorderSide(
                                  color: AppColors.textMuted, width: 1.5),
                              onChanged: onToggleTerms,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: RichText(
                              text: TextSpan(
                                style: GoogleFonts.inter(
                                    fontSize: 13,
                                    color: textSecondary),
                                children: [
                                  const TextSpan(text: 'I agree to the '),
                                  TextSpan(
                                    text: 'Terms & Privacy Policy',
                                    style: GoogleFonts.inter(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w700,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 28),

                    // Continue button
                    _GlowButton(
                      label: 'Continue — Select Property',
                      icon: Icons.arrow_forward_rounded,
                      color: AppColors.primary,
                      onPressed: onContinue,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Already have an account? ',
                      style: GoogleFonts.inter(
                          fontSize: 14, color: textSecondary)),
                  GestureDetector(
                    onTap: onLogin,
                    child: Text(
                      'Log In',
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Step 2: Property verification ─────────────────────────────────────────────

class _PropertyStep extends StatelessWidget {
  final String? phase;
  final String? block;
  final String? lot;
  final List<String> phases;
  final List<String> blocks;
  final List<String> lots;
  final bool isDark;
  final Color surface;
  final Color textPrimary;
  final Color textSecondary;
  final Color borderColor;
  final bool loading;
  final bool canSubmit;
  final ValueChanged<String> onSelectPhase;
  final ValueChanged<String> onSelectBlock;
  final ValueChanged<String> onSelectLot;
  final VoidCallback onSubmit;

  const _PropertyStep({
    super.key,
    required this.phase,
    required this.block,
    required this.lot,
    required this.phases,
    required this.blocks,
    required this.lots,
    required this.isDark,
    required this.surface,
    required this.textPrimary,
    required this.textSecondary,
    required this.borderColor,
    required this.loading,
    required this.canSubmit,
    required this.onSelectPhase,
    required this.onSelectBlock,
    required this.onSelectLot,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    final cardBg = isDark ? AppColors.midnightSurfaceElevated : Colors.white;
    final summary = canSubmit
        ? 'Phase $phase  •  Block $block  •  Lot $lot'
        : 'Select Phase, Block, and Lot to continue';

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 40),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              // ── Hero ──────────────────────────────────────────────
              Center(
                child: Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: AppColors.ctaGreen,
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.ctaGreen.withOpacity(0.38),
                        blurRadius: 22,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.maps_home_work_rounded,
                      color: Colors.white, size: 30),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Verify Your Property',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: textPrimary,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Every report is tied to your registered lot. Select your Phase, Block, and Lot number.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                    fontSize: 14,
                    color: textSecondary,
                    height: 1.5),
              ),
              const SizedBox(height: 28),

              // ── Eyebrow badge ────────────────────────────────────
              Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.08),
                    borderRadius:
                        BorderRadius.circular(AppRadius.pill),
                    border: Border.all(
                        color: AppColors.primary.withOpacity(0.20)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.verified_user_outlined,
                          color: AppColors.primary, size: 13),
                      const SizedBox(width: 6),
                      Text(
                        'VERIFY-FIRST REGISTRY',
                        style: GoogleFonts.inter(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary,
                          letterSpacing: 1.0,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // ── Selector card ────────────────────────────────────
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  border: Border.all(color: borderColor),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black
                          .withOpacity(isDark ? 0.35 : 0.04),
                      blurRadius: 18,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _SelectorSection(
                      label: 'Phase',
                      options: phases,
                      selected: phase,
                      isDark: isDark,
                      textPrimary: textPrimary,
                      onSelected: onSelectPhase,
                    ),
                    const SizedBox(height: 18),
                    _SelectorSection(
                      label: 'Block',
                      options: blocks,
                      selected: block,
                      isDark: isDark,
                      textPrimary: textPrimary,
                      onSelected: onSelectBlock,
                    ),
                    const SizedBox(height: 18),
                    _SelectorSection(
                      label: 'Lot Number',
                      options: lots,
                      selected: lot,
                      isDark: isDark,
                      textPrimary: textPrimary,
                      onSelected: onSelectLot,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // ── Summary card ─────────────────────────────────────
              AnimatedContainer(
                duration: const Duration(milliseconds: 250),
                curve: Curves.fastOutSlowIn,
                padding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 13),
                decoration: BoxDecoration(
                  color: canSubmit
                      ? AppColors.ctaGreen.withOpacity(isDark ? 0.14 : 0.06)
                      : (isDark
                          ? AppColors.midnightSurface
                          : const Color(0xFFF4F5F7)),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(
                    color: canSubmit
                        ? AppColors.ctaGreen.withOpacity(0.30)
                        : borderColor,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      canSubmit
                          ? Icons.location_on_rounded
                          : Icons.location_searching_rounded,
                      size: 17,
                      color: canSubmit
                          ? AppColors.ctaGreen
                          : AppColors.textMuted,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        summary,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: canSubmit
                              ? textPrimary
                              : AppColors.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),

              // ── Info banner ──────────────────────────────────────
              Container(
                padding: const EdgeInsets.all(13),
                decoration: BoxDecoration(
                  color: AppColors.info.withOpacity(0.07),
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(
                      color: AppColors.info.withOpacity(0.20)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.info_outline_rounded,
                        color: AppColors.info, size: 16),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Your address will be cross-verified with the HOA master registry before full activation.',
                        style: GoogleFonts.inter(
                          fontSize: 12.5,
                          color: textSecondary,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),

              // ── Submit button ────────────────────────────────────
              _GlowButton(
                label: loading ? 'Creating Account…' : 'Create Account',
                icon: Icons.check_rounded,
                color: AppColors.ctaGreen,
                onPressed: canSubmit && !loading ? onSubmit : null,
                loading: loading,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Selector section (label + chip wrap) ──────────────────────────────────────

class _SelectorSection extends StatelessWidget {
  final String label;
  final List<String> options;
  final String? selected;
  final bool isDark;
  final Color textPrimary;
  final ValueChanged<String> onSelected;

  const _SelectorSection({
    required this.label,
    required this.options,
    required this.selected,
    required this.isDark,
    required this.textPrimary,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: AppColors.textMuted,
            letterSpacing: 0.6,
          ),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: options.map((opt) {
            final isSelected = opt == selected;
            return GestureDetector(
              onTap: () => onSelected(opt),
              behavior: HitTestBehavior.opaque,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                curve: Curves.fastOutSlowIn,
                constraints: const BoxConstraints(minWidth: 48),
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: isSelected
                      ? AppColors.primary
                      : (isDark
                          ? AppColors.midnightInputFill
                          : const Color(0xFFF4F5F7)),
                  borderRadius:
                      BorderRadius.circular(AppRadius.pill),
                  border: Border.all(
                    color: isSelected
                        ? AppColors.primary
                        : (isDark
                            ? AppColors.innerStroke
                            : const Color(0xFFE2E5EB)),
                  ),
                  boxShadow: isSelected
                      ? [
                          BoxShadow(
                            color: AppColors.primary.withOpacity(0.25),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ]
                      : null,
                ),
                child: Center(
                  child: Text(
                    opt,
                    style: GoogleFonts.inter(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: isSelected
                          ? Colors.white
                          : textPrimary,
                      height: 1,
                    ),
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}

// ── Reusable glow button ───────────────────────────────────────────────────────

class _GlowButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback? onPressed;
  final bool loading;

  const _GlowButton({
    required this.label,
    required this.icon,
    required this.color,
    this.onPressed,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: onPressed != null && !loading
            ? [
                BoxShadow(
                  color: color.withOpacity(0.40),
                  blurRadius: 22,
                  offset: const Offset(0, 8),
                ),
              ]
            : [],
      ),
      child: SizedBox(
        width: double.infinity,
        height: 54,
        child: ElevatedButton.icon(
          onPressed: loading ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: color,
            disabledBackgroundColor: color.withOpacity(0.40),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
          ),
          icon: loading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.2, color: Colors.white),
                )
              : Icon(icon, size: 18),
          label: Text(
            label,
            style: GoogleFonts.inter(
                fontSize: 15, fontWeight: FontWeight.w600),
          ),
        ),
      ),
    );
  }
}
