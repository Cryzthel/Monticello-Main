import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/account_approval_service.dart';
import '../services/firebase_bootstrap.dart';
import '../services/property_storage.dart';
import '../services/theme_mode_controller.dart';
import '../theme/app_theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static const _rememberMeKey = 'login_remember_me_v1';
  static const _savedEmailKey = 'login_saved_email_v1';

  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _loading = false;
  bool _obscurePassword = true;
  bool _rememberMe = false;

  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _bg => _isDark ? AppColors.midnightBase : AppColors.bgLight;
  Color get _surface => _isDark ? AppColors.midnightSurface : AppColors.surfaceLight;
  Color get _textPrimary => _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _textSecondary => _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  Color get _border => _isDark ? AppColors.innerStroke : AppColors.divider;
  Color get _brandColor => _isDark ? AppColors.primaryLight : AppColors.primary;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadRememberedLogin());
  }

  Future<void> _loadRememberedLogin() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final remember = prefs.getBool(_rememberMeKey) ?? false;
      final savedEmail = prefs.getString(_savedEmailKey)?.trim() ?? '';
      if (!mounted) return;

      final args = ModalRoute.of(context)?.settings.arguments;
      String? routeEmail;
      if (args is Map && args['email'] is String) {
        routeEmail = (args['email'] as String).trim();
      }

      setState(() {
        _rememberMe = remember;
        if (routeEmail != null && routeEmail.isNotEmpty) {
          _emailCtrl.text = routeEmail;
        } else if (savedEmail.isNotEmpty) {
          _emailCtrl.text = savedEmail;
        }
      });
    } catch (_) {}
  }

  Future<void> _persistRememberMe() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (_rememberMe) {
        await prefs.setBool(_rememberMeKey, true);
        await prefs.setString(_savedEmailKey, _emailCtrl.text.trim());
      } else {
        await prefs.setBool(_rememberMeKey, false);
        await prefs.remove(_savedEmailKey);
      }
    } catch (_) {}
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final args = ModalRoute.of(context)?.settings.arguments;
    if (args is Map && args['email'] is String) {
      final email = (args['email'] as String).trim();
      if (email.isNotEmpty && _emailCtrl.text.trim().isEmpty) {
        _emailCtrl.text = email;
      }
    }
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  InputDecoration _inputDecoration({
    required String hint,
    required IconData prefixIcon,
    Widget? suffix,
  }) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: _isDark ? AppColors.midnightInputFill : AppColors.bgLight,
      hintStyle: GoogleFonts.inter(fontSize: 14, color: AppColors.textMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      prefixIcon: Icon(prefixIcon, size: 20, color: AppColors.textMuted),
      suffixIcon: suffix,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: _border, width: 1),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: _border, width: 1),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: _brandColor, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.danger, width: 1),
      ),
    );
  }

  Future<void> _routeAfterAuth(User user) async {
    await _persistRememberMe();

    bool approved = true;
    bool verified = true;
    try {
      approved = await AccountApprovalService.isApproved(user.uid);
    } catch (_) {
      approved = true;
    }
    if (!approved) {
      await FirebaseAuth.instance.signOut();
      _showToast('Your account is pending admin verification.', isError: true);
      return;
    }
    try {
      await PropertyStorage.clearIfUserMismatch(user.uid);
      verified = await PropertyStorage.isVerifiedForUser(user.uid);
    } catch (_) {
      verified = true;
    }
    if (!mounted) return;
    await ThemeModeController.instance.loadForUser(user.uid);
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil(
      verified ? '/home' : '/verify',
      (_) => false,
    );
  }

  Future<void> _handleSignIn() async {
    if (!_formKey.currentState!.validate()) return;
    if (!firebaseAppReady) {
      _showToast('Firebase is not ready. Restart app and try again.',
          isError: true);
      return;
    }

    setState(() => _loading = true);
    try {
      final cred = await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: _emailCtrl.text.trim(),
        password: _passwordCtrl.text,
      );
      final user = cred.user;
      if (user != null) {
        await _routeAfterAuth(user);
        return;
      }
      _showToast('Sign in failed. Please try again.', isError: true);
    } on FirebaseAuthException catch (e) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      final current = FirebaseAuth.instance.currentUser;
      if (current != null) {
        await _routeAfterAuth(current);
      } else {
        _showToast(_signInErrorMessage(e), isError: true);
      }
    } catch (_) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      final current = FirebaseAuth.instance.currentUser;
      if (current != null) {
        await _routeAfterAuth(current);
      } else {
        _showToast('Sign in failed. Please try again.', isError: true);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _signInErrorMessage(FirebaseAuthException e) {
    switch (e.code) {
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'Incorrect email or password.';
      case 'invalid-email':
        return 'Please enter a valid email address.';
      case 'too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return e.message ?? 'Sign in failed. Please try again.';
    }
  }

  void _showToast(String message, {bool isError = false}) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        backgroundColor: isError ? AppColors.danger : AppColors.primary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        content: Row(
          children: [
            Icon(
              isError ? Icons.error_outline_rounded : Icons.check_circle_outline_rounded,
              color: Colors.white,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: GoogleFonts.inter(
                    fontSize: 14, color: Colors.white, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 32),
                  Center(
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: _brandColor,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: _brandColor.withValues(alpha:0.3),
                            blurRadius: 24,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.shield_rounded,
                        color: Colors.white,
                        size: 36,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  Text(
                    'Welcome back',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                      color: _textPrimary,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Sign in to your Monticello Villas account',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                        fontSize: 14, color: _textSecondary),
                  ),
                  const SizedBox(height: 40),
                  Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Email',
                          style: GoogleFonts.inter(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: _textPrimary),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _emailCtrl,
                          keyboardType: TextInputType.emailAddress,
                          autocorrect: false,
                          textInputAction: TextInputAction.next,
                          style: GoogleFonts.inter(
                              fontSize: 15, color: _textPrimary),
                          decoration: _inputDecoration(
                            hint: 'you@example.com',
                            prefixIcon: Icons.mail_outline_rounded,
                          ),
                          validator: (v) => (v == null || !v.contains('@'))
                              ? 'Enter a valid email'
                              : null,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          'Password',
                          style: GoogleFonts.inter(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: _textPrimary),
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _passwordCtrl,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          onFieldSubmitted: (_) =>
                              _loading ? null : _handleSignIn(),
                          style: GoogleFonts.inter(
                              fontSize: 15, color: _textPrimary),
                          decoration: _inputDecoration(
                            hint: 'Enter your password',
                            prefixIcon: Icons.lock_outline_rounded,
                            suffix: Padding(
                              padding: const EdgeInsets.only(right: 4),
                              child: IconButton(
                                splashRadius: 20,
                                onPressed: () => setState(
                                    () => _obscurePassword = !_obscurePassword),
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                  size: 20,
                                  color: AppColors.textMuted,
                                ),
                              ),
                            ),
                          ),
                          validator: (v) => (v == null || v.length < 6)
                              ? 'Minimum 6 characters'
                              : null,
                        ),
                        const SizedBox(height: 14),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            GestureDetector(
                              onTap: () => setState(
                                  () => _rememberMe = !_rememberMe),
                              child: Row(
                                children: [
                                  SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: Checkbox(
                                      value: _rememberMe,
                                      activeColor: _brandColor,
                                      checkColor: Colors.white,
                                      shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(4)),
                                      side: BorderSide(
                                          color: _border, width: 1.5),
                                      onChanged: (v) => setState(
                                          () => _rememberMe = v ?? false),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text('Remember me',
                                      style: GoogleFonts.inter(
                                          fontSize: 13,
                                          color: _textSecondary)),
                                ],
                              ),
                            ),
                            TextButton(
                              onPressed: _loading
                                  ? null
                                  : () => Navigator.of(context).pushNamed(
                                        '/forgot-password',
                                        arguments: {
                                          'email': _emailCtrl.text.trim()
                                        },
                                      ),
                              style: TextButton.styleFrom(
                                foregroundColor: _brandColor,
                                padding: EdgeInsets.zero,
                                minimumSize: Size.zero,
                                tapTargetSize:
                                    MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: Text(
                                'Forgot password?',
                                style: GoogleFonts.inter(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: _brandColor),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 28),
                        SizedBox(
                          height: 52,
                          child: ElevatedButton(
                            onPressed: _loading ? null : _handleSignIn,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _brandColor,
                              foregroundColor: Colors.white,
                              disabledBackgroundColor:
                                  _brandColor.withValues(alpha:0.5),
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(AppRadius.sm),
                              ),
                            ),
                            child: _loading
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2.5,
                                        color: Colors.white),
                                  )
                                : Text(
                                    'Sign In',
                                    style: GoogleFonts.inter(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w600,
                                        color: Colors.white),
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 40),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text("Don't have an account? ",
                          style: GoogleFonts.inter(
                              fontSize: 14, color: _textSecondary)),
                      GestureDetector(
                        onTap: _loading
                            ? null
                            : () => Navigator.of(context)
                                .pushNamed('/register'),
                        child: Text(
                          'Sign Up',
                          style: GoogleFonts.inter(
                              fontSize: 14,
                              color: _brandColor,
                              fontWeight: FontWeight.w700),
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
    );
  }
}
