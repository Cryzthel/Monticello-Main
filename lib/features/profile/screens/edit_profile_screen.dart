import 'dart:async';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/core/widgets/staged_submit_button.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:monticello_villas_app/core/widgets/feed_skeletons.dart';

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
  bool _saving = false;
  String _email = '';
  bool _initialized = false;

  String _photoUrl = '';

  /// The photo as it stood when the screen loaded (or last saved). Save stays
  /// disabled until the editable state differs from it — the name and email
  /// are read-only, so the photo is the whole of "what changed".
  String _initialPhotoUrl = '';

  /// A picked photo is a change on its own — it exists only on this device
  /// until Save uploads it.
  bool get _isDirty => _pickedPhoto != null || _photoUrl != _initialPhotoUrl;

  /// The photo chosen from the gallery, shown as the preview. Local only
  /// until Save — see [_save].
  XFile? _pickedPhoto;

  /// True while Save is uploading [_pickedPhoto]; drives the avatar overlay.
  bool _uploadingPhoto = false;
  final _photoUploadCtrl = StagedProgressController();

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
      _email = profile.email;
      _photoUrl = profile.photoUrl;
      _initialPhotoUrl = profile.photoUrl;
    }
    // A refresh re-reads the server copy, so a picked-but-unsaved photo is
    // discarded with it: the preview must not outlive the URL it stood for.
    _pickedPhoto = null;
    setState(() => _initialized = true);
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _photoUploadCtrl.dispose();
    super.dispose();
  }

  TextStyle _sf({
    double size = 15,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double letterSpacing = 0,
  }) {
    return sfPro(
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
          ? (_isDark ? AppColors.midnightSurface : AppColors.backgroundSecondary)
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

  /// The ONE write this screen makes, and only on an explicit Save.
  ///
  /// ── PICKING IS LOCAL ─────────────────────────────────────────────────────
  /// Choosing a photo used to upload it, write users/{uid}.photoUrl and toast
  /// "Profile photo updated." on the spot — so Save had nothing left to save,
  /// and backing out of the screen did not undo anything. A pick now only
  /// swaps the preview ([_pickedPhoto]); the Storage upload, the profile write
  /// and the toast all happen here, after the resident taps Save Changes.
  Future<void> _save() async {
    if (!_isDirty || _saving) return;
    FocusManager.instance.primaryFocus?.unfocus();
    if (!_formKey.currentState!.validate()) return;
    final user = FirebaseAuth.instance.currentUser;
    final svc = UserProfileService.instance;
    final current = svc.profile ?? await svc.load();
    // The load above can take a round trip; the resident may have left.
    if (!mounted) return;
    if (user == null || current == null) {
      _showToast('Please sign in again to update your profile.',
          isError: true);
      return;
    }

    final picked = _pickedPhoto;
    setState(() {
      _saving = true;
      _uploadingPhoto = picked != null;
    });
    // Outside the try, so the subscription below is closed on every exit.
    StreamSubscription<TaskSnapshot>? progressSub;
    try {
      var url = _photoUrl;
      if (picked != null) {
        _photoUploadCtrl.reset();
        final ref = FirebaseStorage.instance
            .ref()
            .child('profile_photos')
            .child('${user.uid}.jpg');
        // Explicit JPEG content type so the upload satisfies the Storage
        // rules, and timeouts so a stalled network can never hang Save.
        final uploadTask = ref.putFile(
          File(picked.path),
          SettableMetadata(contentType: 'image/jpeg'),
        );
        // Live byte progress on the avatar, capped at 99 so 100% means the
        // profile is actually written, not just bytes on the wire. `onError`
        // keeps the task's stream error from escaping the zone; the catch
        // below owns the failure.
        progressSub = uploadTask.snapshotEvents.listen(
          (snapshot) {
            if (snapshot.totalBytes > 0) {
              final pct =
                  snapshot.bytesTransferred / snapshot.totalBytes * 100;
              _photoUploadCtrl.updatePercent(pct.clamp(0, 99));
            }
          },
          onError: (_) {},
        );
        await uploadTask.timeout(const Duration(seconds: 45));
        url = await ref.getDownloadURL().timeout(const Duration(seconds: 20));
      }

      // Only the photo. Name is registered at sign-up and shown read-only
      // here — passing it back through `copyWith` would be this screen
      // re-asserting a value it does not own, and would quietly overwrite a
      // name corrected by staff on the admin dashboard. svc.save() merges and
      // notifies listeners, which re-renders the avatar across the app.
      await svc.save(current.copyWith(photoUrl: url));
      try {
        await user.updatePhotoURL(url);
      } catch (_) {}

      if (!mounted) return;
      _photoUploadCtrl.updatePercent(100);
      setState(() {
        _photoUrl = url;
        _initialPhotoUrl = url;
      });
      _showToast('Profile updated.');
      await Future.delayed(const Duration(milliseconds: 250));
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      // The pick stays on screen: it is still the resident's choice, and
      // Save can simply be tapped again.
      if (mounted) {
        setState(() => _uploadingPhoto = false);
        _showToast('Could not save changes. Please try again.',
            isError: true);
      }
    } finally {
      await progressSub?.cancel();
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Opens the gallery and shows the choice as a preview. Writes nothing.
  Future<void> _pickPhoto() async {
    if (_saving) return;
    try {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 800,
        imageQuality: 80,
      );
      if (file == null || !mounted) return;
      setState(() => _pickedPhoto = file);
    } catch (_) {
      if (mounted) {
        _showToast('Could not open your photos.', isError: true);
      }
    }
  }

  ImageProvider? get _avatarImage {
    if (_pickedPhoto != null) return FileImage(File(_pickedPhoto!.path));
    if (_photoUrl.isNotEmpty) return NetworkImage(_photoUrl);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialized) {
      // The form's own shape, under the real header, rather than a spinner
      // on an empty page.
      return Scaffold(
        backgroundColor: _bg,
        body: const SafeArea(
          child: Column(
            children: [
              PageTitleBar(title: 'Edit Profile'),
              Expanded(child: ProfileFormSkeleton()),
            ],
          ),
        ),
      );
    }

    final initials = _nameCtrl.text.isNotEmpty
        ? _nameCtrl.text.trim().substring(0, 1).toUpperCase()
        : (_email.isNotEmpty ? _email.substring(0, 1).toUpperCase() : 'M');

    return Scaffold(
      backgroundColor: _bg,
      body: SafeArea(
        child: Column(
          children: [
            // The shared header — see PageTitleBar.
            const PageTitleBar(title: 'Edit Profile'),
            Expanded(
              child: DismissKeyboardOnTap(
                child: Form(
          key: _formKey,
          child: RefreshShell(
            onRefresh: _hydrate,
            child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            children: [
              Center(
                child: GestureDetector(
                  onTap: _saving ? null : _pickPhoto,
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
                          image: _avatarImage != null
                              ? DecorationImage(
                                  image: _avatarImage!, fit: BoxFit.cover)
                              : null,
                        ),
                        child: _avatarImage != null
                            ? null
                            : Center(
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
                      // Upload progress overlay — pending shows a floating
                      // percentage only (no bar), then a drawn checkmark once
                      // the photo is fully ready, then fades to reveal it.
                      if (_uploadingPhoto)
                        Positioned.fill(
                          child: AnimatedBuilder(
                            animation: _photoUploadCtrl,
                            builder: (context, _) {
                              final done = _photoUploadCtrl.stage ==
                                  ProgressStage.executing;
                              return AnimatedOpacity(
                                duration: const Duration(milliseconds: 300),
                                opacity: done ? 0 : 1,
                                onEnd: () {
                                  if (done && mounted) {
                                    setState(() => _uploadingPhoto = false);
                                  }
                                },
                                child: Container(
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    // A SCRIM over the avatar photo during
                                    // upload, not an elevation shadow — it has
                                    // to darken whatever image is underneath,
                                    // so it stays black and stays opaque enough
                                    // to read the progress ring against.
                                    color: Colors.black.withValues(alpha: 0.45),
                                  ),
                                  child: Center(
                                    child: StagedProgressView(
                                      controller: _photoUploadCtrl,
                                      color: Colors.white,
                                      percentFontSize: 14,
                                      child: const SizedBox.shrink(),
                                    ),
                                  ),
                                ),
                              );
                            },
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
                            border: Border.all(color: AppColors.background, width: 2),
                          ),
                          child: Icon(
                            _uploadingPhoto
                                ? PhosphorIconsFill.hourglassHigh
                                : PhosphorIconsFill.camera,
                            color: AppColors.background,
                            size: 14,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 28),
              // ── REGISTERED, NOT EDITABLE ────────────────────────────────
              //
              // The name on this account is the one the HOA office verified
              // against the property record, and it is what staff match a
              // report to on the dispatch dashboard. A resident renaming
              // themselves here would silently break that link, which is
              // exactly the case this field cannot be allowed to create.
              //
              // The validator went with the edit. On a field nobody can type
              // in, a failing rule is unfixable — a stored name under two
              // characters would have blocked Save forever with no way out.
              _label('Full name'),
              const SizedBox(height: 6),
              TextFormField(
                controller: _nameCtrl,
                readOnly: true,
                enabled: false,
                style: _sf(size: 15, color: _textSecondary),
                decoration: _decoration(
                  hint: 'Your name',
                  readOnly: true,
                  suffix: Icon(PhosphorIconsFill.lock,
                      size: 18, color: _textSecondary),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Your registered name is set by the HOA office. Contact them '
                'if it needs correcting.',
                style: _sf(size: 11.5, color: _textSecondary),
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
                  suffix: Icon(PhosphorIconsFill.lock,
                      size: 18, color: _textSecondary),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Email is managed by your account and can\'t be changed here.',
                style: _sf(size: 11.5, color: _textSecondary),
              ),
              const SizedBox(height: 24),
              // The app's standard CTA, so Save has the same spinner and the
              // same busy and disabled looks as every other primary action.
              // As a bare ElevatedButton it had no disabled styling, and fell
              // back to Material's grey while saving.
              //
              // Disabled — the shared 60% wash — until something actually
              // differs from what was loaded (a newly picked photo counts), and
              // while a save is in flight.
              StagedSubmitButton(
                label: 'Save Changes',
                busy: _saving,
                onPressed:
                    _saving || !_isDirty ? null : _save,
                color: _brandColor,
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
