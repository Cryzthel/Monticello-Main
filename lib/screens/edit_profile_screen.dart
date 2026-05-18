import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/user_profile_service.dart';
import '../theme/app_theme.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _bg => _isDark ? AppColors.midnightBase : AppColors.bgLight;
  Color get _textPrimary => _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _textSecondary => _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  Color get _fieldFill => _isDark ? AppColors.midnightInputFill : AppColors.bgLight;
  Color get _fieldBorder => _isDark ? AppColors.innerStroke : AppColors.divider;
  Color get _brandColor => _isDark ? AppColors.primaryLight : AppColors.primary;

  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _bioCtrl = TextEditingController();
  bool _saving = false;
  String _email = '';
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  Future<void> _hydrate() async {
    final svc = UserProfileService.instance;
    final profile = svc.profile ?? await svc.load();
    if (!mounted) return;
    if (profile != null) {
      _nameCtrl.text = profile.name;
      _phoneCtrl.text = profile.phone;
      _bioCtrl.text = profile.bio;
      _email = profile.email;
    }
    setState(() => _initialized = true);
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _bioCtrl.dispose();
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

  InputDecoration _decoration({
    required String hint,
    Widget? suffix,
    bool readOnly = false,
  }) {
    return InputDecoration(
      hintText: hint,
      filled: true,
      fillColor: readOnly
          ? (_isDark ? AppColors.midnightSurface : const Color(0xFFFAFAFA))
          : _fieldFill,
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
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
        ),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        duration: const Duration(seconds: 2),
        content: Text(
          message,
          style: _sf(
            size: 14,
            weight: FontWeight.w500,
            color: Colors.white,
          ),
        ),
      ),
    );
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final svc = UserProfileService.instance;
    final current = svc.profile;
    if (current == null) {
      _showToast('Unable to load profile.', isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await svc.save(
        current.copyWith(
          name: _nameCtrl.text.trim(),
          phone: _phoneCtrl.text.trim(),
          bio: _bioCtrl.text.trim(),
        ),
      );
      if (!mounted) return;
      _showToast('Profile updated.');
      await Future.delayed(const Duration(milliseconds: 250));
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        _showToast('Could not save changes.', isError: true);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialized) {
      return Scaffold(
        backgroundColor: _bg,
        body: Center(child: CircularProgressIndicator(color: _brandColor)),
      );
    }

    final initials = _nameCtrl.text.isNotEmpty
        ? _nameCtrl.text.trim().substring(0, 1).toUpperCase()
        : (_email.isNotEmpty ? _email.substring(0, 1).toUpperCase() : 'M');

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
          'Edit profile',
          style: _sf(size: 16, weight: FontWeight.w600, color: _textPrimary),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: Text(
              'Save',
              style: _sf(
                size: 14.5,
                weight: FontWeight.w600,
                color: _saving ? _textSecondary : _brandColor,
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              Center(
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Container(
                      width: 96,
                      height: 96,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _brandColor.withValues(alpha: 0.08),
                        border: Border.all(
                          color: _brandColor.withValues(alpha: 0.18),
                          width: 1.4,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          initials,
                          style: _sf(
                            size: 36,
                            weight: FontWeight.w700,
                            color: _brandColor,
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _brandColor,
                          border: Border.all(color: Colors.white, width: 2),
                        ),
                        child: const Icon(
                          Icons.edit_rounded,
                          color: Colors.white,
                          size: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              _label('Full name'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _nameCtrl,
                style: _sf(size: 15),
                decoration: _decoration(hint: 'Your name'),
                onChanged: (_) => setState(() {}),
                validator: (value) {
                  if ((value ?? '').trim().length < 2) {
                    return 'Name must be at least 2 characters';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              _label('Email'),
              const SizedBox(height: 6),
              TextFormField(
                initialValue: _email,
                readOnly: true,
                enabled: false,
                style: _sf(size: 15, color: _textSecondary),
                decoration: _decoration(
                  hint: 'Email',
                  readOnly: true,
                  suffix: Icon(Icons.lock_outline,
                      size: 18, color: _textSecondary),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Email is managed by your account and can\'t be changed here.',
                style: _sf(size: 11.5, color: _textSecondary),
              ),
              const SizedBox(height: 16),
              _label('Phone'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _phoneCtrl,
                style: _sf(size: 15),
                keyboardType: TextInputType.phone,
                decoration: _decoration(hint: '+63 9XX XXX XXXX'),
              ),
              const SizedBox(height: 16),
              _label('Bio'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _bioCtrl,
                style: _sf(size: 15),
                maxLines: 4,
                maxLength: 160,
                decoration: _decoration(
                  hint: 'Tell your community a little about you',
                ).copyWith(
                  alignLabelWithHint: true,
                  counterStyle: _sf(size: 11, color: _textSecondary),
                ),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _saving ? null : _save,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _brandColor,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                  ),
                  child: _saving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2.2,
                          ),
                        )
                      : Text(
                          'Save changes',
                          style: _sf(
                            size: 15,
                            weight: FontWeight.w600,
                            color: Colors.white,
                          ),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _label(String label) {
    return Text(
      label,
      style: _sf(
        size: 12.5,
        weight: FontWeight.w600,
        color: _textSecondary,
        letterSpacing: 0.3,
      ),
    );
  }
}
