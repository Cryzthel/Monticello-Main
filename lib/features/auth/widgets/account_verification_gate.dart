import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/notifications/push_registration.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/glass_container.dart';
import 'package:monticello_villas_app/core/widgets/gradient_scaffold.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';
import 'package:monticello_villas_app/features/settings/services/session_sign_out.dart';

/// Wraps any resident-facing surface that must stay locked until an admin
/// verifies the account. Listens to [AccountApprovalService.statusStream], so
/// the moment staff hit Approve on the dashboard the resident is moved
/// through to [child] without relaunching the app.
class AccountVerificationGate extends StatefulWidget {
  final Widget child;

  const AccountVerificationGate({super.key, required this.child});

  @override
  State<AccountVerificationGate> createState() => _AccountVerificationGateState();
}

class _AccountVerificationGateState extends State<AccountVerificationGate> {
  String? _uid;

  /// Held in a field rather than created inline in `build`.
  ///
  /// `statusStream(uid)` returns a NEW stream on every call, so building it in
  /// `build` made StreamBuilder tear down and re-subscribe its Firestore
  /// listener on every single rebuild. Memoising it means one subscription,
  /// and gives [_retry] something concrete to replace.
  Stream<String>? _statusStream;

  @override
  void initState() {
    super.initState();
    // Guarantees a resident who lands on the locked screen is actually
    // present in the admin's review queue — see ensureRecordExists.
    AccountApprovalService.ensureRecordExists();
    _subscribe();
  }

  void _subscribe() {
    _uid = FirebaseAuth.instance.currentUser?.uid;
    final uid = _uid;
    _statusStream = uid == null ? null : AccountApprovalService.statusStream(uid);
  }

  /// Re-subscribes in place.
  ///
  /// This used to be `pushNamedAndRemoveUntil('/home', (_) => false)` — which,
  /// now that AuthGate is the root of the tree rather than a route, would have
  /// destroyed the gate it was trying to retry and left nothing listening to
  /// auth state. Rebuilding the stream is both correct and cheaper.
  void _retry() {
    AccountApprovalService.ensureRecordExists();
    setState(_subscribe);
  }

  @override
  Widget build(BuildContext context) {
    final stream = _statusStream;
    // Not signed in — nothing to gate; AuthGate handles that case.
    if (stream == null) return widget.child;

    return StreamBuilder<String>(
      stream: stream,
      // Seeded with the status the previously-mounted gate already observed for
      // this uid. Without it, EVERY navigation to a gated route (`/report`,
      // `/panic`) re-opened a Firestore listener and sat on the holding screen
      // until its first snapshot landed — while the ungated routes, living
      // inside the gate that resolved at launch, carried on working. That is
      // why Reports could look permanently stuck on a near-empty gradient
      // screen while History right next to it was fine.
      //
      // The stream still overrides this the instant it produces a value, so a
      // revoked approval is honoured; this only removes the blank gap before
      // the first emission.
      initialData: AccountApprovalService.cachedStatusFor(_uid!),
      builder: (context, snapshot) {
        // An errored stream never produces data, so checking `hasData` alone
        // left this spinning forever on any Firestore failure — a cold start
        // with no network, an expired token, a rules rejection. The resident
        // saw a permanently loading screen with no explanation and no way out,
        // which reads as "the app is broken", not "you are offline".
        if (snapshot.hasError) {
          return _GateUnavailableScreen(error: snapshot.error, onRetry: _retry);
        }

        // Until the first snapshot arrives we don't know the status. Showing
        // `child` here would flash the full app to an unverified resident, so
        // hold here instead.
        //
        // This used to be a bare `Center(child: CircularProgressIndicator())`
        // on the gradient canvas — a dark-green screen with a ~36px spinner
        // floating in the middle and no text whatsoever. Firestore's
        // `snapshots()` does NOT error when it simply cannot reach the server
        // (it waits), so a device with no connectivity sat on that screen
        // indefinitely. It is indistinguishable from a crashed app, and is
        // almost certainly what "a solid green background with a tiny squeezed
        // container in the centre" describes.
        if (!snapshot.hasData) {
          return _GateLoadingScreen(onRetry: _retry);
        }

        final status = snapshot.data;
        if (status == ResidentStatus.verified) return widget.child;

        return _AccountReviewScreen(
          uid: _uid!,
          rejected: status == ResidentStatus.rejected,
        );
      },
    );
  }
}

/// Shown while the first status snapshot is still in flight.
///
/// Says what is happening, and — crucially — stops pretending after a while.
/// Firestore will wait on a stalled connection forever, so beyond
/// [_stallAfter] this offers the same escape hatches as the error screen
/// rather than spinning for the rest of the session.
class _GateLoadingScreen extends StatefulWidget {
  const _GateLoadingScreen({required this.onRetry});

  final VoidCallback onRetry;

  @override
  State<_GateLoadingScreen> createState() => _GateLoadingScreenState();
}

class _GateLoadingScreenState extends State<_GateLoadingScreen> {
  static const _stallAfter = Duration(seconds: 12);

  bool _stalled = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(_stallAfter, () {
      if (mounted) setState(() => _stalled = true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_stalled) {
      return _GateUnavailableScreen(
        onRetry: widget.onRetry,
        title: 'Still checking…',
        message:
            'Your account status is taking longer than usual to load. This is '
            'almost always a connection problem rather than a problem with '
            'your account.',
      );
    }

    return GradientScaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // The same leaf the rest of the account-loading path shows — see
              // AuthGate's _StartupMessage. This screen and "Loading your
              // account" run back to back on a cold start, so a stock Material
              // wheel here and a leaf there made one continuous wait look like
              // two unrelated ones.
              const LeafLoader(size: 26, color: AppColors.accentPrimary),
              const SizedBox(height: 22),
              Text(
                'Checking your account',
                style: sfPro(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onGlassPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Confirming your verification status with the HOA office.',
                textAlign: TextAlign.center,
                style: sfPro(
                  fontSize: 13.5,
                  height: 1.45,
                  color: AppColors.onGlassSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown when the verification status can't be read at all.
///
/// Deliberately NOT the locked "pending review" screen: telling a resident
/// their account is awaiting approval when the truth is that the device can't
/// reach Firestore would be a fabricated status. This says what actually
/// happened and offers the two things that resolve it.
class _GateUnavailableScreen extends StatelessWidget {
  const _GateUnavailableScreen({
    required this.onRetry,
    this.error,
    this.title = 'Can’t reach the HOA server',
    this.message =
        'We couldn’t check your account status. This is usually a connection '
        'problem — check your internet and try again.',
  });

  final VoidCallback onRetry;
  final Object? error;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: GlassContainer(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.warning.withValues(alpha: 0.16),
                  ),
                  child: const Icon(
                    PhosphorIconsFill.cloudWarning,
                    color: AppColors.warning,
                    size: 28,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  title,
                  style: sfPro(
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onGlassPrimary,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  message,
                  style: sfPro(
                    fontSize: 14,
                    height: 1.5,
                    color: AppColors.onGlassSecondary,
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: 14),
                  Text(
                    '$error',
                    style: sfPro(
                      fontSize: 11.5,
                      height: 1.4,
                      color: AppColors.onGlassSecondary,
                    ),
                  ),
                ],
                const SizedBox(height: 26),
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        onPressed: onRetry,
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          backgroundColor: AppColors.accentPrimary
                              .withValues(alpha: 0.16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(AppRadius.md),
                          ),
                        ),
                        child: Text(
                          'Try again',
                          style: sfPro(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.accentPrimary,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextButton(
                        onPressed: () async {
                          // Cleared before the sign-out so the next account can
                          // never be seeded with this one's verdict.
                          AccountApprovalService.clearStatusCache();
                          await PushRegistration.instance.clear();
                          await FirebaseAuth.instance.signOut();
                          if (!context.mounted) return;
                          Navigator.of(context)
                              .popUntil((route) => route.isFirst);
                        },
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          backgroundColor: Colors.white.withValues(alpha: 0.06),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(AppRadius.md),
                          ),
                        ),
                        child: Text(
                          'Sign out',
                          style: sfPro(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.onGlassPrimary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AccountReviewScreen extends StatelessWidget {
  final String uid;
  final bool rejected;

  const _AccountReviewScreen({required this.uid, required this.rejected});

  Future<void> _signOut(BuildContext context) async {
    await endResidentSession();
    if (!context.mounted) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    final accent = rejected ? AppColors.danger : AppColors.warning;

    return GradientScaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: GlassContainer(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: accent.withValues(alpha: 0.16),
                  ),
                  child: Icon(
                    rejected
                        ? PhosphorIconsFill.xCircle
                        : PhosphorIconsFill.hourglass,
                    color: accent,
                    size: 28,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  rejected
                      ? 'Application Not Approved'
                      : 'Account Pending Verification',
                  style: sfPro(
                    fontSize: 21,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onGlassPrimary,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  rejected
                      ? 'The HOA office reviewed your registration and could not approve it.'
                      : 'Your registration has been submitted to the HOA office. '
                          'A administrator is reviewing your property details. '
                          'This screen updates automatically once approved — '
                          'no need to restart the app.',
                  style: sfPro(
                    fontSize: 14,
                    height: 1.5,
                    color: AppColors.onGlassSecondary,
                  ),
                ),

                if (rejected) ...[
                  const SizedBox(height: 18),
                  StreamBuilder<String?>(
                    stream: AccountApprovalService.rejectionReasonStream(uid),
                    builder: (context, snap) {
                      final reason = snap.data;
                      if (reason == null) return const SizedBox.shrink();
                      return Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.danger.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(
                            color: AppColors.danger.withValues(alpha: 0.30),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Reason',
                              style: sfPro(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppColors.danger,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              reason,
                              style: sfPro(
                                fontSize: 13.5,
                                height: 1.45,
                                color: AppColors.onGlassPrimary,
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Contact the HOA office to correct your details and re-apply.',
                    style: sfPro(
                      fontSize: 12.5,
                      color: AppColors.onGlassSecondary,
                    ),
                  ),
                ],

                const SizedBox(height: 26),
                SizedBox(
                  width: double.infinity,
                  child: TextButton(
                    onPressed: () => _signOut(context),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      backgroundColor: Colors.white.withValues(alpha: 0.06),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                      ),
                    ),
                    child: Text(
                      'Sign out',
                      style: sfPro(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.onGlassPrimary,
                      ),
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
