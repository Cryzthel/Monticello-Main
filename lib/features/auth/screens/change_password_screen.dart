import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_theme.dart';

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _bg => _isDark ? AppColors.midnightBase : AppColors.bgLight;
  Color get _textPrimary => _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _textSecondary => _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  Color get _fieldFill => _isDark ? AppColors.midnightInputFill : AppColors.bgLight;
  Color get _fieldBorder => _isDark ? AppColors.innerStroke : AppColors.divider;
  Color get _brandColor => _isDark ? AppColors.primaryLight : AppColors.primary;

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

  TextStyle _sf({
    double size = 15,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double letterSpacing = 0,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color ?? _textPrimary,
      letterSpacing: letterSpacing,
    );
  }

  InputDecoration _inputDecoration({
    required String hint,
    required Widget suffix,
  }) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: _fieldFill,
      hintStyle: _sf(size: 14, color: _textSecondary),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      suffixIcon: suffix,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: _fieldBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: _fieldBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: BorderSide(color: _brandColor, width: 1.4),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        borderSide: const BorderSide(color: AppColors.danger),
      ),
    );
  }

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
          style: _sf(size: 13, color: Colors.white, weight: FontWeight.w500),
        ),
      ),
    );
  }

  bool _isStrong(String v) {
    final hasMinLength = v.length >= 8;
    final hasNumber = v.contains(RegExp(r'\d'));
    final hasSpecial =
        v.contains(RegExp(r'[!@#$%^&*(),.?":{}|<>_\-\\/\[\]`~+=;]'));
    return hasMinLength && hasNumber && hasSpecial;
  }

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
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded,
              color: _textPrimary, size: 18),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        centerTitle: true,
        title: Text(
          'Change Password',
          style: _sf(size: 16, weight: FontWeight.w600),
        ),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 32),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'For your security, enter your current password, then choose a new one.',
                  style: _sf(
                      size: 13.5, color: _textSecondary, letterSpacing: 0.1),
                ),
                const SizedBox(height: 18),
                TextFormField(
                  controller: _currentCtrl,
                  obscureText: _obscureCurrent,
                  style: _sf(size: 15),
                  decoration: _inputDecoration(
                    hint: 'Current password',
                    suffix: IconButton(
                      splashRadius: 18,
                      onPressed: () =>
                          setState(() => _obscureCurrent = !_obscureCurrent),
                      icon: Icon(
                        _obscureCurrent
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        size: 20,
                        color: _textSecondary,
                      ),
                    ),
                  ),
                  validator: (v) => (v == null || v.isEmpty)
                      ? 'Enter current password'
                      : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _newCtrl,
                  obscureText: _obscureNew,
                  style: _sf(size: 15),
                  decoration: _inputDecoration(
                    hint: 'New password',
                    suffix: IconButton(
                      splashRadius: 18,
                      onPressed: () =>
                          setState(() => _obscureNew = !_obscureNew),
                      icon: Icon(
                        _obscureNew
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        size: 20,
                        color: _textSecondary,
                      ),
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Enter new password';
                    if (!_isStrong(v))
                      return 'Use 8+ chars, number & special character';
                    if (v == _currentCtrl.text)
                      return 'New password must be different';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _confirmCtrl,
                  obscureText: _obscureConfirm,
                  style: _sf(size: 15),
                  decoration: _inputDecoration(
                    hint: 'Confirm new password',
                    suffix: IconButton(
                      splashRadius: 18,
                      onPressed: () =>
                          setState(() => _obscureConfirm = !_obscureConfirm),
                      icon: Icon(
                        _obscureConfirm
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        size: 20,
                        color: _textSecondary,
                      ),
                    ),
                  ),
                  validator: (v) =>
                      v != _newCtrl.text ? 'Passwords do not match' : null,
                  onFieldSubmitted: (_) => _saving ? null : _changePassword(),
                ),
                const SizedBox(height: 22),
                SizedBox(
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _saving ? null : _changePassword,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _brandColor,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppRadius.sm)),
                      elevation: 0,
                    ),
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white),
                          )
                        : Text(
                            'Save Changes',
                            style: _sf(
                                size: 15,
                                weight: FontWeight.w600,
                                color: Colors.white),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
