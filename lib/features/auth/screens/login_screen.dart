import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/core/brand/brand_mark.dart';
import 'package:monticello_villas_app/core/firebase/firebase_bootstrap.dart';
import 'package:monticello_villas_app/core/theme/theme_mode_controller.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/auth/services/email_rule.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_scaffold.dart';

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
  // `_bg` is gone with the Scaffold that read it; AuthScaffold owns the
  // canvas for both auth screens, so the two cannot drift apart.
  Color get _textPrimary =>
      _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _textSecondary =>
      _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  // `_border` lived here and is gone with the Material Checkbox that used
  // it. Its value was `AppColors.divider` — emerald-100 at 80% — which is why
  // the Remember-me box rendered as a pale green square beside a form whose
  // every other outline is slate. AuthCheckbox owns its own colours.
  // `_brandColor` lived here and is gone with the controls that used it. The
  // threshold's green is AuthTokens.brand (#047857) — see the contrast note
  // on that token. It is a constant rather than a theme-derived getter
  // because the sign-in screen is deliberately NOT themed: it is the one
  // surface that has to match the web portals' sign-in exactly.

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

  /// Post-sign-in work that is specific to LOGGING IN, and nothing else.
  ///
  /// This deliberately no longer navigates. AuthGate (lib/app/auth_gate.dart)
  /// is the root of the tree and rebuilds off `authStateChanges()`, so the
  /// moment sign-in succeeds it swaps LoginScreen out for the verification
  /// gate / dashboard on its own.
  ///
  /// The previous `pushNamedAndRemoveUntil('/home', (_) => false)` now actively
  /// fights that: it tears down the whole stack — including the AuthGate at the
  /// root — and pushes a bare `/home` route in its place. It also duplicated
  /// the property/profile loading that AuthGate already does, so the same
  /// awaits ran twice and any failure among them silently cancelled the
  /// navigation that was supposed to follow.
  Future<void> _routeAfterAuth(User user) async {
    await _persistRememberMe();
    try {
      await ThemeModeController.instance.loadForUser(user.uid);
    } catch (_) {
      // Cosmetic only — never block sign-in on a theme preference read.
    }
    // No Navigator call. AuthGate takes it from here.
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
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        // The threshold's green, like every other accent on these two
        // screens. A success toast in #16A34A over a form built in
        // #047857 is the brand changing shade on the way to confirming
        // that something worked.
        backgroundColor: isError ? AppColors.danger : AuthTokens.brand,
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
                    // White on both. Dark ink on the danger red was the
                    // one toast in the app that did it, and it read at a
                    // fraction of the contrast of every other error.
                    color: AppColors.background,
                    fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // ── THE SHELL IS SHARED, AND IT CENTRES ──────────────────────────
    // `AuthScaffold` carries the flat canvas and tap-to-dismiss;
    // `AuthFormPane` carries the centring, which `Center` inside a plain
    // scroll view could never do — see the long note on that class.
    //
    // The leading 8pt spacer is gone with the layout that needed it: it
    // existed to nudge a top-anchored column off the status bar, and a
    // centred one has no top to be nudged from.
    return AuthScaffold(
      child: AuthFormPane(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The real emblem, bare — no tile behind it.
            //
            // This was a 72px rounded square filled with the brand green
            // holding a Phosphor shield: a STAND-IN, from before the
            // artwork was wired up on mobile, and the same stand-in the
            // splash carried. Two things go with it. The glyph, because
            // BrandMark is now the actual logo. And the tile, because a
            // coloured container behind a logo is an app-icon
            // impression, and the icon is already on the home screen the
            // resident just tapped — repeating it at the top of the
            // first form reads as chrome rather than as identity.
            const Center(
              child: BrandMark(
                height: 56,
                color: AuthTokens.brand,
                semanticLabel: 'Monticello Villas',
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'Welcome back',
              textAlign: TextAlign.center,
              // The display face. One element per screen — see
              // displayFont's doc, and --font-display in the portals.
              style: displayFont(
                fontSize: 26,
                fontWeight: FontWeight.w800,
                color: _textPrimary,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Sign in to your Monticello Villas account',
              textAlign: TextAlign.center,
              style: sfPro(fontSize: 14, color: _textSecondary),
            ),
            const SizedBox(height: 32),
            Form(
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
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.username],
                    validator: EmailRule.validate,
                  ),
                  const SizedBox(height: 16),
                  AuthField(
                    label: 'Password',
                    controller: _passwordCtrl,
                    hint: 'Enter your password',
                    obscureText: _obscurePassword,
                    autocorrect: false,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.password],
                    onSubmitted: (_) => _loading ? null : _handleSignIn(),
                    // Sized to the 48px capsule rather than Material's
                    // default 48px-plus-padding IconButton, which forced
                    // the field taller than the button below it.
                    trailing: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () =>
                          setState(() => _obscurePassword = !_obscurePassword),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 4, vertical: 12),
                        child: Icon(
                          _obscurePassword
                              ? PhosphorIconsFill.eyeSlash
                              : PhosphorIconsFill.eye,
                          size: 20,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                    // Presence only. The length rule is the password
                    // POLICY (8, not the 6 this checked), and a sign-in
                    // field that enforces it refuses any older password
                    // that predates the rule.
                    validator: (v) =>
                        v.isEmpty ? 'Enter your password.' : null,
                  ),
                  const SizedBox(height: 12),
                  // ── ONE LINE, ALWAYS, AND IT CANNOT OVERFLOW ──────
                  // This was a Row, then a Wrap, and both were wrong in
                  // opposite directions. A Row cannot break, so at a
                  // large text scale it painted the overflow stripe
                  // across the sign-in form. A Wrap breaks too eagerly:
                  // on a 360dp handset it dropped "Forgot password?"
                  // onto its own line, left-aligned under the checkbox,
                  // which reads as two unrelated controls rather than as
                  // the pair either side of a line.
                  //
                  // A Row with the LEFT side flexible is the answer to
                  // both: the link keeps its intrinsic width because it
                  // is the thing you have to be able to read and hit,
                  // and "Remember me" gives up room first, ellipsising
                  // only in the extreme case where there is genuinely
                  // none left.
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () =>
                              setState(() => _rememberMe = !_rememberMe),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              AuthCheckbox(checked: _rememberMe),
                              const SizedBox(width: 10),
                              Flexible(
                                child: Text(
                                  'Remember me',
                                  overflow: TextOverflow.ellipsis,
                                  style: sfPro(
                                    fontSize: 13,
                                    color: _textSecondary,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: _loading
                            ? null
                            : () => Navigator.of(context).pushNamed(
                                  '/forgot-password',
                                  arguments: {'email': _emailCtrl.text.trim()},
                                ),
                        child: Padding(
                          // Vertical only: the row's height is already
                          // the checkbox's, and padding the sides would
                          // push the link off the form's right edge.
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          child: Text(
                            'Forgot password?',
                            style: sfPro(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AuthTokens.brand,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  AuthButton(
                    label: 'Sign In',
                    busy: _loading,
                    onPressed: _loading ? null : _handleSignIn,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            // Wrap, not Row. As a Row this overflowed by 28px whenever
            // the two labels were wider than the available line — on a
            // narrow device, at a large system text scale, or under a
            // fallback font whose metrics differ from the bundled one
            // (which is what made the widget test fail). A Row cannot
            // break, so it painted the yellow-and-black overflow stripe
            // across the bottom of the sign-in screen; Wrap simply moves
            // "Sign Up" onto the next line and stays centred.
            Wrap(
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text("Don't have an account? ",
                    style: sfPro(fontSize: 14, color: _textSecondary)),
                GestureDetector(
                  onTap: _loading
                      ? null
                      : () => Navigator.of(context).pushNamed('/register'),
                  child: Text(
                    'Sign Up',
                    style: sfPro(
                        fontSize: 14,
                        color: AuthTokens.brand,
                        fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
