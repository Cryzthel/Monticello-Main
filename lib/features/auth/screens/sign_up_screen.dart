import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/gestures.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/modern_close_button.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';
import 'package:monticello_villas_app/core/firebase/firebase_bootstrap.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/features/property/services/property_storage.dart';
import 'package:monticello_villas_app/core/theme/theme_mode_controller.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/brand/brand_mark.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/features/auth/services/password_policy.dart';
import 'package:monticello_villas_app/features/auth/services/verification_document_service.dart';
import 'package:monticello_villas_app/features/auth/widgets/residency_proof_card.dart';
import 'package:monticello_villas_app/features/auth/widgets/property_pickers.dart';
import 'package:monticello_villas_app/features/auth/widgets/resident_type_selector.dart';
import 'package:monticello_villas_app/features/auth/services/email_rule.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_scaffold.dart';
import 'package:monticello_villas_app/core/widgets/staged_submit_button.dart';
import 'package:monticello_villas_app/features/legal/legal_content.dart';
import 'package:monticello_villas_app/features/legal/legal_document_view.dart';

/// Which policy an inline link in the agreement row points at.
///
/// The sheet carries ONE document — five sections, of which these are the
/// first two — rather than splitting into two sheets with two accept gates.
/// A resident agrees to the whole thing once; offering "accept" twice would
/// be two legal claims where there is one. The links therefore open the same
/// sheet and scroll it to the section they name.
enum TermsSection { terms, privacy }

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen>
    with SingleTickerProviderStateMixin {
  int _step = 0;

  final _formKey = GlobalKey<FormState>();
  final _fullNameCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  bool _agreedToTerms = false;
  bool _hasReadTerms = false;
  bool _hasMinLength = false;
  bool _hasNumber = false;
  bool _hasSpecial = false;
  bool _wasEmpty = true;

  String? _phase;
  String? _block;
  String? _lot;

  // Owner or tenant. Defaulted rather than nullable so the record always
  // carries an explicit type. KEPT: it is a single tap, it is not on the
  // removal list, and it changes what staff verify the claim against.
  String _residentType = ResidentType.homeowner;

  // ── THE GOVERNMENT ID IS BACK, AND MANDATORY ─────────────────────────────
  // It was removed once, on the reasoning that the HOA office could collect
  // proof of residency after the account existed. That is reversed by
  // request: staff want the ID in hand when the application reaches the
  // Pending queue, so registration cannot complete without one.
  //
  // The cost it was removed for — an upload that can fail on estate mobile
  // data — is handled rather than ignored: the photo is validated on the
  // form before anything is sent, and a failed upload leaves the form open
  // with a retry instead of losing the registration.
  File? _idFile;
  String? _idName;
  int? _idBytes;
  double? _idProgress;
  IdUploadStatus _idStatus = IdUploadStatus.none;
  String? _idError;
  String? _idUrl;
  bool _idAttached = false;
  final _picker = ImagePicker();

  // Set once the Firebase account exists. A retry after a failed ID upload
  // resumes from here: creating the account again would only fail with
  // email-already-in-use.
  User? _createdUser;
  bool _recordWritten = false;

  bool _loading = false;
  final _signupProgressCtrl = StagedProgressController();

  // ── ADDRESS OPTIONS NOW COME FROM THE ESTATE'S REAL SCHEDULE ──────────────
  //
  // These were three hardcoded lists: phases 1-5, blocks 1-8, lots 01-08. The
  // estate has no Phase 4; its blocks run well past 8 (Phase 2 has twenty) and
  // its lots well past 08 (Phase 3 Block 1 reaches 111). So the form offered
  // addresses that do not exist and refused most of the ones that do — and an
  // applicant who could not find their own lot picked the nearest wrong one.
  // That guess is exactly what the HOA office is now being asked to verify
  // against, which makes it worth fixing in the same pass.
  //
  // Driven off SubdivisionDirectory, the same 1,444-lot table the incident
  // reporter reads, so the two cannot disagree.
  List<String> get _phases => SubdivisionDirectory.loadedPhases;

  List<String> get _blocks {
    final phase = _phase;
    if (phase == null) return const [];
    return [
      for (final spec in SubdivisionDirectory.blocksIn(phase))
        spec.block.toString(),
    ];
  }

  List<String> get _lots {
    final phase = _phase;
    final block = int.tryParse(_block ?? '');
    if (phase == null || block == null) return const [];
    for (final spec in SubdivisionDirectory.blocksIn(phase)) {
      if (spec.block != block) continue;
      // Expanded from the runs, so the gaps stay gaps: Phase 2 Block 11 offers
      // its 46 real lots, not 1-56.
      return [
        for (final run in spec.runs)
          for (var lot = run.first; lot <= run.last; lot++) lot.toString(),
      ];
    }
    return const [];
  }

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
    _signupProgressCtrl.dispose();
    super.dispose();
  }

  void _onPasswordChanged() {
    final v = _passwordCtrl.text;
    final minLen = PasswordPolicy.hasMinLength(v);
    final num = PasswordPolicy.hasNumber(v);
    final special = PasswordPolicy.hasSpecial(v);
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
    if (_strengthScore >= 0.95) return AppColors.success;
    if (_strengthScore >= 0.6) return AppColors.warning;
    return AppColors.danger;
  }

  /// The chosen address is one the estate actually has.
  ///
  /// The pickers only ever offer real lots, so this is a second check rather
  /// than the first — but it is the one the submit path trusts, so an address
  /// that reaches Firestore has been checked against the site-plan schedule
  /// by the same function the incident reporter uses.
  bool get _addressValid {
    final phase = _phase;
    final block = int.tryParse(_block ?? '');
    final lot = int.tryParse(_lot ?? '');
    if (phase == null || block == null || lot == null) return false;
    return SubdivisionDirectory.exists(phase, block, lot);
  }

  /// Enabled once the address is complete. The ID is checked on press rather
  /// than by disabling the button: a greyed-out button does not say what is
  /// missing, and an error on the ID card does.
  bool get _canSubmit => _addressValid;

  String get _submitLabel =>
      _createdUser != null && _idStatus == IdUploadStatus.failed
          ? 'Retry ID Upload'
          : 'Complete Registration';

  Future<void> _pickId() async {
    if (_loading) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final source = await showModalBottomSheet<_IdSource>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => const _IdSourceSheet(),
    );
    if (source == null || !mounted) return;

    String? path;
    String? name;
    try {
      if (source == _IdSource.document) {
        // PDFs only here. Photos go through image_picker below, which can
        // resize them; file_picker would hand back the camera's original.
        final result = await FilePicker.pickFiles(
          type: FileType.custom,
          allowedExtensions: const ['pdf'],
        );
        final picked = result?.files.single;
        path = picked?.path;
        name = picked?.name;
      } else {
        // Resized and re-encoded on the device. A 12MP photo of a card is
        // 4-6 MB of detail nobody needs; 2048px keeps the print on an ID
        // legible and lands well under the 10 MB storage rule. On iOS this
        // is also what turns a HEIC capture into a JPEG the portal can show.
        final picked = await _picker.pickImage(
          source: source == _IdSource.camera
              ? ImageSource.camera
              : ImageSource.gallery,
          maxWidth: 2048,
          maxHeight: 2048,
          imageQuality: 85,
        );
        path = picked?.path;
        name = picked?.name;
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _idError = switch (source) {
            _IdSource.camera =>
              'The camera could not be opened. Check the app\'s camera permission.',
            _IdSource.photos =>
              'Your photos could not be opened. Check the app\'s photo permission.',
            _IdSource.document => 'Your files could not be opened. Try again.',
          });
      return;
    }
    if (path == null || !mounted) return;

    final file = File(path);
    var bytes = 0;
    try {
      bytes = await file.length();
    } catch (_) {}
    final error = VerificationIdRules.validate(path: path, bytes: bytes);
    if (!mounted) return;
    setState(() {
      if (error != null) {
        // A refused file does not replace an accepted one already chosen.
        _idError = error;
        return;
      }
      _idFile = file;
      _idName = name;
      _idBytes = bytes;
      _idStatus = IdUploadStatus.ready;
      _idProgress = null;
      _idError = null;
      _idUrl = null;
      _idAttached = false;
    });
  }

  void _removeId() {
    setState(() {
      _idFile = null;
      _idName = null;
      _idBytes = null;
      _idProgress = null;
      _idStatus = IdUploadStatus.none;
      _idError = null;
      _idUrl = null;
      _idAttached = false;
    });
  }

  void _showTermsSheet({TermsSection? section}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _TermsBottomSheet(
        initialSection: section,
        onAccepted: () {
          Navigator.pop(context);
          setState(() {
            _hasReadTerms = true;
            _agreedToTerms = true;
          });
        },
      ),
    );
  }

  void _goToStep2() {
    if (!_formKey.currentState!.validate()) return;
    if (!_agreedToTerms) {
      _toast('Please agree to the Terms and Privacy Policy.', isError: true);
      return;
    }
    setState(() => _step = 1);
  }

  void _goBack() {
    if (_loading) return;
    if (_createdUser != null) {
      Navigator.of(context).popUntil((route) => route.isFirst);
      return;
    }
    if (_step == 0) {
      Navigator.of(context).maybePop();
    } else {
      setState(() => _step = 0);
    }
  }

  Future<void> _createAccount() async {
    if (_loading || !_canSubmit) return;
    if (_idFile == null) {
      setState(() => _idError =
          'Add your HOA ID or proof of residency to finish registering.');
      return;
    }
    if (_idError != null) return;
    if (!firebaseAppReady) {
      _toast('Firebase is not ready. Restart and try again.', isError: true);
      return;
    }

    final fullName = _fullNameCtrl.text.trim();
    final email = _emailCtrl.text.trim();
    final password = _passwordCtrl.text;

    setState(() => _loading = true);
    _signupProgressCtrl.reset();
    try {
      final existing = _createdUser;
      if (existing != null) {
        await _finishSignUp(user: existing, fullName: fullName, email: email);
        return;
      }
      final cred = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      _signupProgressCtrl.updatePercent(30);
      final user = cred.user ?? FirebaseAuth.instance.currentUser;
      if (user != null) {
        _createdUser = user;
        await _finishSignUp(user: user, fullName: fullName, email: email);
        return;
      }
      _toast('Could not create account. Try again.', isError: true);
    } on FirebaseAuthException catch (e) {
      final maybe = FirebaseAuth.instance.currentUser;
      if (maybe != null) {
        _createdUser = maybe;
        await _finishSignUp(user: maybe, fullName: fullName, email: email);
        return;
      }
      _toast(_authError(e), isError: true);
    } catch (_) {
      final maybe = FirebaseAuth.instance.currentUser;
      if (maybe != null) {
        _createdUser = maybe;
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
    // Written once. A retry after a failed ID upload skips straight to the
    // upload rather than re-stamping the review record.
    if (!_recordWritten) {
      if (fullName.isNotEmpty) {
        try {
          await user.updateDisplayName(fullName);
        } catch (_) {}
      }
      _signupProgressCtrl.updatePercent(45);

      // MUST run before saveVerifiedProperty. That call also writes to
      // residents/{uid}, and if it lands first the doc exists *without* a
      // verificationStatus — which turns this write into an UPDATE, and the
      // owner-update rule requires verificationStatus to stay unchanged
      // (absent -> 'pending' fails). The write was then silently swallowed,
      // leaving the resident invisible/blank on the admin Residents page.
      // Creating the doc here first keeps this on the `allow create` path,
      // which an owner is always permitted.
      try {
        await AccountApprovalService.markPending(
          uid: user.uid,
          email: email,
          name: fullName,
          // Carry the property claim onto the record staff actually review,
          // so the Residents module can show what to verify against without
          // a second lookup into `properties/{uid}`.
          phase: _phase,
          block: _block,
          lot: _lot,
          residentType: _residentType,
          source: 'email_password',
        );
      } catch (err) {
        // The gate's ensureRecordExists() is the safety net, but the error
        // should at least be visible in logs.
        debugPrint('markPending failed during signup: $err');
      }
      _recordWritten = true;
    }
    _signupProgressCtrl.updatePercent(55);

    // ── THE ID, AFTER THE RECORD AND BEFORE EVERYTHING ELSE ──────────────
    // After markPending, because the storage path is keyed by the uid and the
    // URL is attached to the record that call creates. Before the rest,
    // because it is the one step that is allowed to stop registration.
    if (!_idAttached) {
      if (mounted) {
        setState(() {
          _idStatus = IdUploadStatus.uploading;
          _idProgress = null;
        });
      }
      _idUrl ??= await VerificationDocumentService.uploadId(
        uid: user.uid,
        file: _idFile!,
        onProgress: (fraction) {
          if (mounted) setState(() => _idProgress = fraction);
        },
      );
      _signupProgressCtrl.updatePercent(62);
      final url = _idUrl;
      if (url != null) {
        try {
          await VerificationDocumentService.attachToResident(
            uid: user.uid,
            url: url,
          );
          _idAttached = true;
        } catch (err) {
          debugPrint('Attaching the ID to residents/${user.uid} failed: $err');
        }
      }
      if (!mounted) return;
      if (!_idAttached) {
        setState(() => _idStatus = IdUploadStatus.failed);
        _toast(
          'Your account is created, but your ID did not upload. '
          'Check your connection and tap Retry.',
          isError: true,
        );
        return;
      }
      setState(() => _idStatus = IdUploadStatus.uploaded);
    }
    _signupProgressCtrl.updatePercent(66);

    // No longer branched on here: AuthGate re-reads the saved property itself
    // and decides between the dashboard and the property-verification screen.
    // Keeping a local copy would just be a second, staler opinion.
    try {
      await PropertyStorage.saveVerifiedProperty(
        uid: user.uid,
        phase: _phase!,
        block: _block!,
        lot: _lot!,
      );
    } catch (_) {}
    _signupProgressCtrl.updatePercent(70);

    try {
      await UserProfileService.instance.save(UserProfile(
        uid: user.uid,
        name: fullName,
        email: email,
      ));
    } catch (_) {}
    _signupProgressCtrl.updatePercent(85);

    if (!mounted) return;
    await ThemeModeController.instance.loadForUser(user.uid);
    if (!mounted) return;
    await UserProfileService.instance.load();
    LocalDataStore.instance.startListening();
    if (!mounted) return;
    _signupProgressCtrl.updatePercent(97);

    // Reaching 100 plays the checkmark and holds briefly before this
    // resolves — the same finalize beat used on the incident-report submit
    // button — so we only navigate once that confirmation has been seen.
    await _signupProgressCtrl.updatePercent(100);
    if (!mounted) return;
    _toast('Account created. Your account is pending HOA verification.');

    // Pop back to the root, do NOT push a destination.
    //
    // `createUserWithEmailAndPassword` already signed this user in, so AuthGate
    // (the root of the tree) has been showing the correct destination —
    // property verification or the dashboard — since the moment the account was
    // created. This screen is a route sitting on top of it; popping reveals it.
    //
    // The previous `pushNamedAndRemoveUntil(..., (_) => false)` tore down the
    // entire stack INCLUDING AuthGate and pushed a bare route in its place.
    // With the root gate gone, nothing was left listening to auth state, so any
    // later transition — verification being approved, signing out — had nothing
    // to swap the tree, stranding the user on whatever that route rendered.
    Navigator.of(context).popUntil((route) => route.isFirst);
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
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        content: Row(
          children: [
            Icon(
              isError ? PhosphorIconsFill.warningCircle : PhosphorIconsFill.checkCircle,
              color: Colors.white,
              size: 20,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: sfPro(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.white),
              ),
            ),
          ],
        ),
      ));
  }

  @override
  Widget build(BuildContext context) {
    // `bg` is gone with the Scaffold that read it — AuthScaffold owns the
    // canvas for both auth screens, so the two cannot drift apart.
    final surface = AppColors.backgroundSecondary;
    final textPrimary = AppColors.textPrimary;
    final textSecondary = AppColors.textSecondary;
    // ── ONE HAIRLINE ──────────────────────────────────────────────────
    // Was `AuthTokens.border` — emerald-100 at 80%, a GREEN hairline.
    // That token is right for the app's glass surfaces and wrong here: it
    // outlined the resident-type chips, the property summary and the
    // dropdowns in faint green, directly beside capsule fields outlined in
    // slate. Two hairline colours on one form, neither wrong alone, together
    // reading as a screen assembled from two kits.
    final borderColor = AuthTokens.border;
    final fillColor = AppColors.backgroundSecondary;

    // Same shell as sign-in, so the two halves of the threshold behave
    // identically: one canvas colour, one tap-to-dismiss, one centring rule.
    // The back row is the `header` rather than the first thing in the scroll
    // area — a way back that scrolls off the top is a way back you have to go
    // looking for.
    return AuthScaffold(
      header: _SignUpNav(onBack: _goBack),
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
          hasReadTerms: _hasReadTerms,
          hasMinLength: _hasMinLength,
          hasNumber: _hasNumber,
          hasSpecial: _hasSpecial,
          wasEmpty: _wasEmpty,
          strengthScore: _strengthScore,
          strengthColor: _strengthColor,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
          borderColor: borderColor,
          fillColor: fillColor,
          onTogglePassword: () =>
              setState(() => _obscurePassword = !_obscurePassword),
          onToggleConfirm: () =>
              setState(() => _obscureConfirm = !_obscureConfirm),
          onToggleTerms: (v) {
            if (!_hasReadTerms) {
              _showTermsSheet();
            } else {
              setState(() => _agreedToTerms = v ?? false);
            }
          },
          onShowTerms: _showTermsSheet,
          onContinue: _goToStep2,
          // Pop back to the login screen that is already
          // underneath this route, rather than pushing a second
          // one. `pushReplacementNamed('/login')` stacked a
          // routed LoginScreen ON TOP of the one AuthGate
          // renders; signing in there swapped the tree
          // underneath while the pushed route stayed on screen,
          // so the user appeared stuck on the login form.
          onLogin: () => Navigator.of(context).maybePop(),
        )
      : _PropertyStep(
          key: const ValueKey('step1'),
          phase: _phase,
          block: _block,
          lot: _lot,
          phases: _phases,
          blocks: _blocks,
          lots: _lots,
          surface: surface,
          textPrimary: textPrimary,
          textSecondary: textSecondary,
          borderColor: borderColor,
          loading: _loading,
          canSubmit: _canSubmit,
          progressController: _signupProgressCtrl,
          // Cascading, now that the options below depend on the
          // choice above. Keeping a stale Block 20 after a switch
          // to Phase 5 (which stops at Block 5) would submit an
          // address the estate does not have.
          onSelectPhase: (v) => setState(() {
            _phase = v;
            _block = null;
            _lot = null;
          }),
          onSelectBlock: (v) => setState(() {
            _block = v;
            _lot = null;
          }),
          onSelectLot: (v) => setState(() => _lot = v),
          onSubmit: _createAccount,
          submitLabel: _submitLabel,
          residentType: _residentType,
          onSelectResidentType: (v) =>
              setState(() => _residentType = v),
          idFile: _idFile,
          idName: _idName,
          idBytes: _idBytes,
          idProgress: _idProgress,
          idStatus: _idStatus,
          idError: _idError,
          onPickId: _pickId,
          onRemoveId: _removeId,
        ),
      ),
    );
  }
}

// ── Sign-up navigation ───────────────────────────────────────────────────────

/// Just a back button.
///
/// ── WHAT WAS HERE, AND WHY IT IS GONE ────────────────────────────────────
/// A two-node step indicator: a rail, numbered discs, the labels "Account"
/// and "Property", and a "Step 1 of 2" caption underneath — about 110pt of
/// vertical space at the top of a form that already struggles to fit a 667pt
/// phone.
///
/// A progress indicator earns its space when the length of a flow is unknown
/// or discouraging, and it tells you something the screen cannot. Neither
/// holds here. The flow is two steps; the second one is titled "Property
/// Details" in 24pt type immediately below this row; and the button at the
/// bottom of step one says "Continue" while the button at the bottom of step
/// two says "Complete Registration". The indicator was restating, three
/// times over, what the page already says — and charging a third of the
/// viewport for it.
///
/// What is kept is the part that was never decoration: a way back. The
/// gesture it mirrors — Android's system back, and the iOS edge swipe — is
/// already wired to the same `_goBack`, so this row is the visible affordance
/// for a route the user can take anyway.
class _SignUpNav extends StatelessWidget {
  const _SignUpNav({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // The 18pt bottom inset the step header carried is gone with it: each
      // step opens with its own 8pt top padding and the emblem, so the rhythm
      // below this row belongs to the step, not to the chrome above it.
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Align(
        alignment: Alignment.centerLeft,
        child: ModernBackButton(onPressed: onBack),
      ),
    );
  }
}


/// The "I agree" row: a box, a sentence, and two real links.
///
/// ── WHY THE WHOLE ROW IS STILL TAPPABLE ───────────────────────────────────
/// A 22pt box is a 22pt target, which is half of what a finger needs. Rather
/// than inflate the box — which is what Material's 48pt minimum does, and what
/// broke the alignment here in the first place — the row is the target and the
/// box is only its picture. The two links sit inside that target and win the
/// tap for themselves, because a `TapGestureRecognizer` on a span beats an
/// ancestor's `GestureDetector` in the arena.
///
/// ── THE READ-FIRST GATE IS KEPT ───────────────────────────────────────────
/// Until the policies have actually been opened, the box cannot be ticked:
/// pressing it opens them instead. That is deliberate and unchanged — this is
/// the one screen where "I agree" is a legal claim about something the person
/// may not have seen. What changed is that it now says so in a line under the
/// sentence rather than only by refusing to move.
class _TermsRow extends StatelessWidget {
  const _TermsRow({
    required this.agreed,
    required this.hasRead,
    required this.onToggle,
    required this.onOpen,
  });

  final bool agreed;
  final bool hasRead;
  final VoidCallback onToggle;
  final void Function({TermsSection? section}) onOpen;

  @override
  Widget build(BuildContext context) {
    final link = sfPro(
      fontSize: 13,
      fontWeight: FontWeight.w700,
      color: AuthTokens.brand,
      decoration: TextDecoration.underline,
      decorationColor: AuthTokens.brand,
    );

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: hasRead ? onToggle : () => onOpen(),
      // ── NO CARD ───────────────────────────────────────────────────────
      // This sat in a bordered, tinted box that changed fill and border
      // colour when the box was ticked. Three things were wrong with it.
      //
      // It was the only card on the form: four capsule fields, then a
      // rectangle, then a capsule button — so the one row that is not an
      // input looked like the most important thing on the screen. It also
      // put a second outline directly under a stack of outlined fields,
      // which is the nested-container reading the rest of this pass has
      // been removing. And the tint duplicated the checkbox: the tick is
      // what says "agreed", and a container that says it again in 4% green
      // is saying it in the quieter of the two places.
      //
      // Vertical padding only, so the row still has a comfortable 44pt tap
      // height and still aligns with the fields above it rather than being
      // inset from them.
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          // The box tracks the FIRST LINE of the sentence, not the centre of
          // the paragraph. `start` plus the 1pt nudge below puts its optical
          // centre on that line's x-height.
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── CENTRED ON THE FIRST LINE, NOT ON THE PARAGRAPH ───────
            // The sentence wraps to two or three lines, so there are two
            // different "centres" to choose between and only one of them is
            // right. Centring on the BLOCK puts the box halfway down a
            // paragraph, level with nothing. Centring on the first LINE puts
            // it where a reader looks for it.
            //
            // Computed rather than nudged: the line box is 13pt text at the
            // 1.45 height the sentence sets, so wrapping the 18pt box in a
            // SizedBox of exactly that height and centring inside it lands
            // the two midlines together whatever the font metrics turn out
            // to be. The `top: 1` guess this replaces was half a point out.
            SizedBox(
              height: 13 * 1.45,
              child: Center(child: AuthCheckbox(checked: agreed)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      style: sfPro(
                        fontSize: 13,
                        height: 1.45,
                        color: AppColors.textSecondary,
                      ),
                      children: [
                        const TextSpan(text: 'I agree to the '),
                        TextSpan(
                          text: 'Terms and Conditions',
                          style: link,
                          recognizer: TapGestureRecognizer()
                            ..onTap = () =>
                                onOpen(section: TermsSection.terms),
                        ),
                        const TextSpan(text: ' and '),
                        TextSpan(
                          text: 'Privacy Policy',
                          style: link,
                          recognizer: TapGestureRecognizer()
                            ..onTap = () =>
                                onOpen(section: TermsSection.privacy),
                        ),
                        const TextSpan(text: '.'),
                      ],
                    ),
                  ),
                  // The "Open either one to continue." line lived here.
                  //
                  // Removed by request. The gate it explained STAYS: a press
                  // before the policies have been opened still opens them
                  // rather than ticking the box. That teaches itself — press,
                  // the policy opens, read, accept, the box ticks — which is
                  // a shorter loop than reading a caption about it first.
                  //
                  // What it costs is the one case the caption covered: a
                  // resident who presses, dismisses the sheet without
                  // scrolling, and presses again gets the same sheet with no
                  // words explaining why. Worth knowing; not worth a
                  // permanent line of 11.5pt grey under every registration.
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Terms & Privacy Bottom Sheet (must scroll to accept) ─────────────────────

class _TermsBottomSheet extends StatefulWidget {
  final VoidCallback onAccepted;

  /// Scroll straight to this policy on open. Null opens at the top.
  final TermsSection? initialSection;
  const _TermsBottomSheet({required this.onAccepted, this.initialSection});

  @override
  State<_TermsBottomSheet> createState() => _TermsBottomSheetState();
}

class _TermsBottomSheetState extends State<_TermsBottomSheet> {
  final _scrollController = ScrollController();
  bool _scrolledToEnd = false;

  /// Anchors for the two sections an inline link can point at.
  final _termsKey = GlobalKey();
  final _privacyKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_checkScroll);
    // ── A DOCUMENT THAT FITS HAS BEEN READ TO THE END ────────────────────
    // The gate only cleared from a scroll event. On a tablet, or at a small
    // text size, the whole policy fits in the sheet, there is nothing to
    // scroll, the listener never fires — and Accept stayed disabled forever,
    // with no way to register. Checked once the sheet has laid out.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scrollController.hasClients) _checkScroll();
    });
    if (widget.initialSection != null) {
      // After the first frame, because the target has no position until the
      // sheet has laid out. `ensureVisible` rather than a pixel offset: the
      // section's distance down the document depends on how the body text
      // wrapped, which depends on the width and the resident's text size.
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToSection());
    }
  }

  void _jumpToSection() {
    final key = widget.initialSection == TermsSection.privacy
        ? _privacyKey
        : _termsKey;
    final target = key.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
      // Just under the header, not centred: a heading parked in the middle
      // of the sheet reads as the end of the previous section.
      alignment: 0.02,
    );
    // NOTE: this does NOT satisfy the read-to-the-end gate. Jumping to
    // Privacy lands mid-document, `_checkScroll` does not fire at the
    // bottom, and Accept stays disabled — which is the point. The link is a
    // way to READ a policy, not a way around having read them.
  }

  void _checkScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 50) {
      if (!_scrolledToEnd) setState(() => _scrolledToEnd = true);
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.85,
      ),
      decoration: const BoxDecoration(
        color: AppColors.backgroundSecondary,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          Center(
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AuthTokens.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 4, 24, 16),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AuthTokens.brand.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(PhosphorIconsFill.gavel,
                      color: AuthTokens.brand, size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Terms & Privacy Policy',
                        style: sfPro(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      Text(
                        'Please read through to continue',
                        style: sfPro(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const ModernCloseButton(semanticLabel: 'Close'),
              ],
            ),
          ),
          const Divider(height: 1, color: AuthTokens.border),
          Expanded(
            child: SingleChildScrollView(
              controller: _scrollController,
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // The same text Settings shows later — one source, so what a
                  // resident accepts here is what they can re-read there.
                  KeyedSubtree(
                    key: _termsKey,
                    child: const LegalDocumentBody(document: termsAndConditions),
                  ),
                  const SizedBox(height: 32),
                  const Divider(height: 1, color: AuthTokens.border),
                  const SizedBox(height: 32),
                  KeyedSubtree(
                    key: _privacyKey,
                    child: const LegalDocumentBody(document: privacyPolicy),
                  ),
                  const SizedBox(height: 32),
                  if (!_scrolledToEnd)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.info.withValues(alpha: 0.07),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.info.withValues(alpha: 0.20)),
                      ),
                      child: Row(
                        children: [
                          // infoInk on both: sky-500 measures 2.59:1 against
                          // the 7% wash this notice paints (#EEF9FD), and the
                          // one instruction standing between a resident and
                          // the terms they are about to accept should not be
                          // the faintest line on the screen. The ink is
                          // 7.06:1 on that wash.
                          const Icon(PhosphorIconsFill.arrowDown,
                              color: AppColors.infoInk, size: 16),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Scroll down to read the full terms before accepting.',
                              style: sfPro(
                                fontSize: 12.5,
                                color: AppColors.infoInk,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          Container(
            padding: EdgeInsets.fromLTRB(
                24, 16, 24, MediaQuery.of(context).padding.bottom + 16),
            decoration: const BoxDecoration(
              color: AppColors.backgroundSecondary,
              border: Border(top: BorderSide(color: AuthTokens.border)),
            ),
            child: SizedBox(
              width: double.infinity,
              height: 54,
              child: ElevatedButton(
                onPressed: _scrolledToEnd ? widget.onAccepted : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AuthTokens.brand,
                  disabledBackgroundColor: AuthTokens.brand.withValues(alpha: 0.35),
                  foregroundColor: AppColors.background,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                child: Text(
                  _scrolledToEnd
                      ? 'I Accept the Terms & Privacy Policy'
                      : 'Read to Continue',
                  style: sfPro(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: AppColors.background),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Step 1: Credentials ──────────────────────────────────────────────────────

class _CredentialsStep extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController fullNameCtrl;
  final TextEditingController emailCtrl;
  final TextEditingController passwordCtrl;
  final TextEditingController confirmCtrl;
  final bool obscurePassword;
  final bool obscureConfirm;
  final bool agreedToTerms;
  final bool hasReadTerms;
  final bool hasMinLength;
  final bool hasNumber;
  final bool hasSpecial;
  final bool wasEmpty;
  final double strengthScore;
  final Color strengthColor;
  final Color textPrimary;
  final Color textSecondary;
  final Color borderColor;
  final Color fillColor;
  final VoidCallback onTogglePassword;
  final VoidCallback onToggleConfirm;
  final ValueChanged<bool?> onToggleTerms;
  final void Function({TermsSection? section}) onShowTerms;
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
    required this.hasReadTerms,
    required this.hasMinLength,
    required this.hasNumber,
    required this.hasSpecial,
    required this.wasEmpty,
    required this.strengthScore,
    required this.strengthColor,
    required this.textPrimary,
    required this.textSecondary,
    required this.borderColor,
    required this.fillColor,
    required this.onTogglePassword,
    required this.onToggleConfirm,
    required this.onToggleTerms,
    required this.onShowTerms,
    required this.onContinue,
    required this.onLogin,
  });

  Widget _requirement(String text, bool ok) => Padding(
        padding: const EdgeInsets.only(top: 6, left: 4),
        child: Row(
          children: [
            Icon(
              ok ? PhosphorIconsFill.checkCircle : PhosphorIconsFill.circle,
              size: 15,
              color: ok ? AppColors.success : AppColors.textMuted,
            ),
            const SizedBox(width: 8),
            Text(
              text,
              style: sfPro(
                fontSize: 12.5,
                color: ok ? textPrimary : textSecondary,
                fontWeight: ok ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    // Centred on the shared pane. See AuthFormPane for why the Center
    // this replaces could not centre anything.
    return AuthFormPane(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The emblem, matching the sign-in screen exactly.
          //
          // This was a green tile holding a `userPlus` glyph. That is an
          // illustration of the ACTION, not the brand, and it meant the
          // two halves of the threshold opened with two different marks:
          // a shield on sign-in, a person-plus here. The resident
          // crossing between them saw the identity change. One mark, both
          // screens.
          const Center(
            child: BrandMark(
              height: 52,
              color: AuthTokens.brand,
              semanticLabel: 'Monticello Villas',
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Create Account',
            textAlign: TextAlign.center,
            style: displayFont(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              color: textPrimary,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Set up your credentials to get started.',
            textAlign: TextAlign.center,
            style: sfPro(
                fontSize: 14, color: textSecondary),
          ),
          const SizedBox(height: 32),

          Form(
            key: formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AuthField(
                  label: 'Full Name',
                  controller: fullNameCtrl,
                  hint: 'e.g. Juan dela Cruz',
                  textInputAction: TextInputAction.next,
                  textCapitalization: TextCapitalization.words,
                  autofillHints: const [AutofillHints.name],
                  validator: (v) =>
                      v.trim().length < 2 ? 'Enter your full name' : null,
                ),
                const SizedBox(height: 16),
                AuthField(
                  label: 'Email Address',
                  controller: emailCtrl,
                  hint: 'name@example.com',
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.newUsername],
                  validator: EmailRule.validate,
                ),
                const SizedBox(height: 16),
                AuthField(
                  label: 'Password',
                  controller: passwordCtrl,
                  hint: 'At least 8 characters',
                  obscureText: obscurePassword,
                  autocorrect: false,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.newPassword],
                  trailing: _RevealToggle(
                    obscured: obscurePassword,
                    onTap: onTogglePassword,
                  ),
                  validator: (v) {
                    if (v.isEmpty) return 'Enter a password';
                    if (!hasMinLength || !hasNumber || !hasSpecial) {
                      return 'Password requirements not met';
                    }
                    return null;
                  },
                ),

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
                                  backgroundColor:
                                      AuthTokens.border,
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
                const SizedBox(height: 16),
                AuthField(
                  label: 'Confirm Password',
                  controller: confirmCtrl,
                  hint: 'Re-type your password',
                  obscureText: obscureConfirm,
                  autocorrect: false,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.newPassword],
                  trailing: _RevealToggle(
                    obscured: obscureConfirm,
                    onTap: onToggleConfirm,
                  ),
                  validator: (v) =>
                      v != passwordCtrl.text
                          ? 'Passwords do not match'
                          : null,
                ),
                const SizedBox(height: 22),

                // ── THE AGREEMENT ROW ──────────────────────────────
                // Rebuilt, and the three things that were wrong are worth
                // naming because each looked like a style problem and was
                // a behaviour problem.
                //
                // 1. THE LINK WAS NOT A LINK. "Terms & Privacy Policy" was
                //    a bare TextSpan in brand green with no recognizer —
                //    it looked tappable, and tapping it hit the row's
                //    GestureDetector, which once the terms had been read
                //    TOGGLED THE CHECKBOX. Pressing a link to read a
                //    policy silently un-agreed to it. The two spans below
                //    carry real recognizers and the arena gives them the
                //    tap, so the row's own handler never sees it.
                //
                // 2. THE CHECKBOX WAS CRUSHED. A Material Checkbox has a
                //    48pt minimum tap target; it was wrapped in a 22x22
                //    SizedBox, so its own padding pushed the glyph off the
                //    centre of the slot and the box sat visibly left of
                //    and below the text it belonged to. This is a plain
                //    painted box at exactly the size it claims, and the
                //    whole row is the tap target — which it already was.
                //
                // 3. IT CENTRED AGAINST THE WHOLE BLOCK. `center` with a
                //    two-line label put the box halfway down the
                //    paragraph. It aligns to the FIRST LINE now, which is
                //    where a reader looks for it.
                _TermsRow(
                  agreed: agreedToTerms,
                  hasRead: hasReadTerms,
                  onToggle: () => onToggleTerms(!agreedToTerms),
                  onOpen: onShowTerms,
                ),
                const SizedBox(height: 28),

                // One word. It read "Continue — Select Property" beside an
                // arrow, which is three statements about the same tap: what
                // it does, where it goes, and a glyph repeating "forward".
                // The step it opens is titled Property Details; the button
                // does not need to announce it as well.
                StagedSubmitButton(
                  label: 'Continue',
                  onPressed: onContinue,
                  color: AuthTokens.brand,
                  borderRadius: AuthTokens.radius,
                  heightOverride: AuthTokens.controlHeight,
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          // Wrap, not Row — the same fix the sign-in screen carries, for
          // the same reason. As a Row this overflowed the content box by
          // 115pt at 375pt width once the labels were measured against a
          // font with real metrics, and a Row cannot break: it painted
          // the yellow-and-black overflow stripe across the bottom of the
          // registration form. Wrap moves "Log In" onto the next line.
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('Already have an account? ',
                  style: sfPro(
                      fontSize: 14, color: textSecondary)),
              GestureDetector(
                onTap: onLogin,
                child: Text(
                  'Log In',
                  style: sfPro(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AuthTokens.brand,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Step 2: Property verification with searchable dropdown ──────────────────

/// Small uppercase caption above a verification input.
class _FieldLabel extends StatelessWidget {
  final String text;
  final Color color;

  const _FieldLabel({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: sfPro(
        fontSize: 11.5,
        fontWeight: FontWeight.w700,
        color: color,
        letterSpacing: 0.3,
      ),
    );
  }
}

// _PlainField lived here — the unvalidated input the two emergency-contact
// boxes used. It had no other caller, so it left with them.

class _PropertyStep extends StatelessWidget {
  final String? phase;
  final String? block;
  final String? lot;
  final List<String> phases;
  final List<String> blocks;
  final List<String> lots;
  final Color surface;
  final Color textPrimary;
  final Color textSecondary;
  final Color borderColor;
  final bool loading;
  final bool canSubmit;
  final StagedProgressController progressController;
  final ValueChanged<String> onSelectPhase;
  final ValueChanged<String> onSelectBlock;
  final ValueChanged<String> onSelectLot;
  final VoidCallback onSubmit;
  final String submitLabel;

  // Owner or tenant. Changes what staff verify the claim against.
  final String residentType;
  final ValueChanged<String> onSelectResidentType;

  // The HOA ID / proof of residency — see the note on the state's `_idFile`.
  final File? idFile;
  final String? idName;
  final int? idBytes;
  final double? idProgress;
  final IdUploadStatus idStatus;
  final String? idError;
  final VoidCallback onPickId;
  final VoidCallback onRemoveId;

  const _PropertyStep({
    super.key,
    required this.phase,
    required this.block,
    required this.lot,
    required this.phases,
    required this.blocks,
    required this.lots,
    required this.surface,
    required this.textPrimary,
    required this.textSecondary,
    required this.borderColor,
    required this.loading,
    required this.canSubmit,
    required this.progressController,
    required this.onSelectPhase,
    required this.onSelectBlock,
    required this.onSelectLot,
    required this.onSubmit,
    required this.submitLabel,
    required this.residentType,
    required this.onSelectResidentType,
    required this.idFile,
    required this.idName,
    required this.idBytes,
    required this.idProgress,
    required this.idStatus,
    required this.idError,
    required this.onPickId,
    required this.onRemoveId,
  });

  @override
  Widget build(BuildContext context) {
    // Centred on the shared pane, like step one and like sign-in. The
    // asymmetric 40pt bottom padding went with the top-anchored layout —
    // it was there to stop the last control sitting on the screen edge,
    // which centring handles on its own.
    return AuthFormPane(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // No tile here, and no emblem either.
          //
          // This was a green square holding a `buildingApartment` glyph —
          // the last of the stand-in tiles. Step ONE opens with the
          // emblem because it is the entrance; step two is the middle of
          // a flow the resident is already in, and a second large mark
          // above it restarts the page rather than continuing it. The
          // heading does the work.
          const SizedBox(height: 4),
          // NOT "Verify Your Property" any more. This step no longer
          // verifies anything — it collects the address, and the HOA office
          // checks it against the registry afterwards. A heading promising
          // verification set up the wrong expectation about what submitting
          // the form achieves.
          // Left-aligned, heading and body both. Centred body copy makes the
          // eye find a new starting point on every line, and a centred heading
          // over left-aligned fields has nothing to line up with.
          Text(
            'Your Property',
            textAlign: TextAlign.start,
            style: displayFont(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              color: textPrimary,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Tell us where you live and add an ID or proof of residency. '
            'The HOA office checks both before activating your account.',
            textAlign: TextAlign.start,
            style: sfPro(
                fontSize: 14,
                color: textSecondary,
                height: 1.5),
          ),
          const SizedBox(height: 28),

          // Phase, Block, Lot: three identical selector cards in one row,
          // each opening a sheet of real numbers. See property_pickers.dart.
          _FieldLabel(text: 'Property', color: textSecondary),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: PropertyNumberField(
                  label: 'Phase',
                  options: phases,
                  value: phase,
                  enabled: !loading,
                  disabledHint: 'No phases are available.',
                  onChanged: onSelectPhase,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: PropertyNumberField(
                  label: 'Block',
                  options: blocks,
                  value: block,
                  enabled: !loading,
                  disabledHint: 'Choose a phase first.',
                  onChanged: onSelectBlock,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: PropertyNumberField(
                  label: 'Lot',
                  options: lots,
                  value: lot,
                  enabled: !loading,
                  disabledHint: 'Choose a block first.',
                  onChanged: onSelectLot,
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),

          // ── Resident type ───────────────────────────────────────────
          _FieldLabel(text: 'Resident Type', color: textSecondary),
          const SizedBox(height: 8),
          ResidentTypeSelector(
            value: residentType,
            enabled: !loading,
            onChanged: onSelectResidentType,
          ),
          const SizedBox(height: 22),

          // ── HOA ID / Proof of Residency ─────────────────────────────
          // Named for what the HOA office actually accepts. "Government ID"
          // told a tenant with a lease and no local ID that they could not
          // register.
          _FieldLabel(
              text: 'HOA ID / Proof of Residency', color: textSecondary),
          const SizedBox(height: 4),
          Text(
            'A valid ID, title, lease or utility bill showing your name.',
            style: sfPro(fontSize: 12.5, color: textSecondary, height: 1.4),
          ),
          const SizedBox(height: 10),
          ResidencyProofCard(
            file: idFile,
            fileName: idName,
            bytes: idBytes,
            status: idStatus,
            progress: idProgress,
            error: idError,
            enabled: !loading,
            onPick: onPickId,
            onRemove: onRemoveId,
          ),

          // ── WHAT WAS HERE ─────────────────────────────────────────────
          // A summary card ("Select Phase, Block, and Lot to continue", then
          // the address once chosen) and a blue info banner about the HOA
          // registry. Both are gone. The three fields above already show the
          // address, so the summary repeated it in a fourth box; the banner
          // said what the subtitle now says. That was two more bordered
          // containers, in two more colours, between the form and its button.
          const SizedBox(height: 28),

          // No leading glyph: a checkmark BEFORE the action is taken says
          // the opposite of what it means, and the same tick is what the
          // button draws once the account actually exists.
          // "Complete Registration", not "Create Account".
          //
          // With the step indicator gone, the buttons are the only thing
          // telling a resident where they are in the flow, so they have
          // to carry that weight themselves: "Continue" means there is
          // more, "Complete Registration" means this is the last tap.
          // "Create Account" was ambiguous in exactly the wrong place —
          // it is also a fair description of what the FIRST step does.
          StagedSubmitButton(
            label: submitLabel,
            onPressed: canSubmit && !loading ? onSubmit : null,
            busy: loading,
            controller: progressController,
            color: AuthTokens.brand,
            borderRadius: AuthTokens.radius,
            heightOverride: AuthTokens.controlHeight,
          ),
        ],
      ),
    );
  }
}

/// The eye in a password capsule.
///
/// Not an [IconButton]: Material gives one a 48pt minimum tap target plus its
/// own padding, which pushed the 48pt field taller than the button beneath it
/// and broke the one-height rhythm the capsule system is built on. The
/// padding below keeps the tap target at 44pt — Apple's floor — inside a
/// control that is only 48pt tall.
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

enum _IdSource { camera, photos, document }

/// Camera, library or a PDF, as a plain sheet of rows.
class _IdSourceSheet extends StatelessWidget {
  const _IdSourceSheet();

  @override
  Widget build(BuildContext context) {
    Widget option(IconData icon, String label, _IdSource source) {
      return InkWell(
        onTap: () => Navigator.of(context).pop(source),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              children: [
                Icon(icon, size: 20, color: AppColors.textSecondary),
                const SizedBox(width: 14),
                Text(
                  label,
                  style: sfPro(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: AppColors.background,
          borderRadius: BorderRadius.circular(AppRadius.lg),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
              child: Text(
                'HOA ID / Proof of Residency',
                style: sfPro(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
            option(PhosphorIconsFill.camera, 'Take a photo', _IdSource.camera),
            option(PhosphorIconsFill.images, 'Choose from photos',
                _IdSource.photos),
            option(PhosphorIconsFill.filePdf, 'Upload a PDF',
                _IdSource.document),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
