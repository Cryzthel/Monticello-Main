import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/auth/services/password_policy.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _currentCtrl = TextEditingController();
  final _newCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();

  bool _obscureCurrent = true;
  bool _obscureNew = true;
  bool _obscureConfirm = true;
  bool _saving = false;

  @override
  void dispose() {
    _currentCtrl.dispose();
    _newCtrl.dispose();
    _confirmCtrl.dispose();
    super.dispose();
  }

  // `_inputDecoration` lived here: a hand-rolled OutlineInputBorder set,
  // the last one in the app. AuthField owns the capsule, the floating label
  // and the placeholder's tracking now.

  void _showToast(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        content: Text(
          message,
          // `sfPro`, not the `_sf` helper this method used to call: that
          // helper returned `GoogleFonts.inter`, from before the app moved
          // to Nunito Sans for parity with the portals. It went with
          // `_inputDecoration`, and restoring it would have put one Inter
          // string back into an app that no longer renders Inter anywhere.
          style: sfPro(
              fontSize: 13, color: Colors.white, fontWeight: FontWeight.w500),
        ),
      ),
    );
  }
  // The rules live in PasswordPolicy, shared with sign-up and the reset step.
  bool _isStrong(String v) => PasswordPolicy.isStrong(v);

  Future<void> _changePassword() async {
    if (_saving || !_formKey.currentState!.validate()) return;

    final user = FirebaseAuth.instance.currentUser;
    if (user == null || (user.email ?? '').isEmpty) {
      _showToast('Sign in again then try changing your password.',
          isError: true);
      return;
    }

    setState(() => _saving = true);
    try {
      final credential = EmailAuthProvider.credential(
        email: user.email!,
        password: _currentCtrl.text,
      );
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(_newCtrl.text);
      if (!mounted) return;
      _showToast('Password changed successfully.');
      Navigator.of(context).pop();
    } on FirebaseAuthException catch (e) {
      if (e.code == 'wrong-password' || e.code == 'invalid-credential') {
        _showToast('Current password is incorrect.', isError: true);
      } else if (e.code == 'weak-password') {
        _showToast('New password is too weak.', isError: true);
      } else if (e.code == 'requires-recent-login') {
        _showToast('Please sign in again and try changing password.',
            isError: true);
      } else {
        _showToast(e.message ?? 'Could not change password.', isError: true);
      }
    } catch (_) {
      _showToast('Could not change password. Try again.', isError: true);
    } finally {
      if (mounted) setState(() => _saving = false);
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
            // report flow's header exactly, title truly centered against
            // the full header width via a Stack (not just the leftover
            // space after the back button).
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: SizedBox(
                height: 44, // 44px minimum touch target for ModernBackButton
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: ModernBackButton(),
                    ),
                    Text(
                      'Change Password',
                      textAlign: TextAlign.center,
                      style: sfPro(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                          color: AppColors.textPrimary),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: DismissKeyboardOnTap(
                child: Form(
          key: _formKey,
          // Full-width, left-aligned form with standard screen gutters — the
          // same layout/size as the Settings list and the other form pages.
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Update your password',
                  style: sfPro(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Enter your current password, then choose a strong new one.',
                  style: sfPro(
                      fontSize: 13.5,
                      color: AppColors.textSecondary,
                      height: 1.4),
                ),
                const SizedBox(height: 24),
                AuthField(
                  label: 'Current Password',
                  controller: _currentCtrl,
                  hint: 'Enter current password',
                  obscureText: _obscureCurrent,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.password],
                  trailing: _RevealToggle(
                    obscured: _obscureCurrent,
                    onTap: () =>
                        setState(() => _obscureCurrent = !_obscureCurrent),
                  ),
                  validator: (v) =>
                      v.isEmpty ? 'Enter current password' : null,
                ),
                const SizedBox(height: 16),
                AuthField(
                  label: 'New Password',
                  controller: _newCtrl,
                  hint: 'At least 8 characters',
                  obscureText: _obscureNew,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.newPassword],
                  // Repaints the checklist below on every keystroke. The
                  // field already rebuilds for its own validation; this is
                  // what carries that rebuild out to the requirement rows.
                  onChanged: (_) => setState(() {}),
                  trailing: _RevealToggle(
                    obscured: _obscureNew,
                    onTap: () => setState(() => _obscureNew = !_obscureNew),
                  ),
                  validator: (v) {
                    if (v.isEmpty) return 'Enter a new password';
                    if (!_isStrong(v)) {
                      return 'Password requirements not met';
                    }
                    if (v == _currentCtrl.text) {
                      return 'New password must be different';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 14),
                _PasswordRequirements(password: _newCtrl.text),
                const SizedBox(height: 16),
                AuthField(
                  label: 'Confirm New Password',
                  controller: _confirmCtrl,
                  hint: 'Re-type your new password',
                  obscureText: _obscureConfirm,
                  autocorrect: false,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.newPassword],
                  trailing: _RevealToggle(
                    obscured: _obscureConfirm,
                    onTap: () =>
                        setState(() => _obscureConfirm = !_obscureConfirm),
                  ),
                  onSubmitted: (_) => _saving ? null : _changePassword(),
                  validator: (v) =>
                      v != _newCtrl.text ? 'Passwords do not match' : null,
                ),
                const SizedBox(height: 28),
                // The same capsule CTA as sign-in and registration. This was
                // a 52pt square-cornered ElevatedButton directly under three
                // 48pt capsules — the one control on the screen that did not
                // belong to the form above it.
                AuthButton(
                  label: 'Update Password',
                  busy: _saving,
                  onPressed: _saving ? null : _changePassword,
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
}

/// The eye in a password capsule — the same control sign-up uses, for the
/// same reason: a Material IconButton's 48pt minimum tap target pushes the
/// 48pt field taller than everything beside it.
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

class _PasswordRequirements extends StatelessWidget {
  final String password;
  const _PasswordRequirements({required this.password});

  @override
  Widget build(BuildContext context) {
    // ── THE SAME THREE RULES CREATE ACCOUNT SHOWS, WORD FOR WORD ───────
    // This listed FOUR, with "One uppercase letter" among them, and the
    // labels were phrased differently ("One number" against sign-up's "At
    // least one number"). Two screens in one app disagreeing about what a
    // strong password is, in both substance and wording.
    //
    // NOTE THAT THIS RELAXES THE POLICY on this screen: uppercase is no
    // longer required to change a password, because it was never required
    // to create one. Syncing the other way — adding uppercase to sign-up —
    // would have been the stricter choice and was not what was asked for.
    // `_isStrong` is updated in step, so the checklist and the thing it
    // describes cannot drift apart again.
    final met = PasswordPolicy.check(password);
    final checks = [
      for (var i = 0; i < PasswordPolicy.labels.length; i++)
        (label: PasswordPolicy.labels[i], met: met[i]),
    ];

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: AppColors.innerStroke),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Password Requirements',
            style: sfPro(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: AppColors.textMuted,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 10),
          ...checks.map((c) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Icon(
                      c.met
                          ? PhosphorIconsFill.checkCircle
                          : PhosphorIconsFill.circle,
                      size: 16,
                      color: c.met ? AppColors.success : AppColors.textMuted,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      c.label,
                      style: sfPro(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w500,
                        color: c.met
                            ? AppColors.textPrimary
                            : AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}
