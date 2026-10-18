import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';

/// What the app currently knows about the signed-in resident's standing.
///
/// [unknown] is a first-class value, not a placeholder. Firestore's
/// `snapshots()` does NOT error when it cannot reach the server — it waits — so
/// "we have not been told yet" is a state a resident can sit in for the whole
/// session on a bad connection, and it must not be confused with "not
/// verified".
enum ResidentVerification { unknown, verified, pending, rejected }

extension ResidentVerificationX on ResidentVerification {
  /// Whether privileged actions — filing a report, raising a panic alert —
  /// should be locked.
  ///
  /// TRUE ONLY FOR A STATUS WE HAVE ACTUALLY OBSERVED. [unknown] does not lock,
  /// deliberately: defaulting an unreadable status to "locked" would put a lock
  /// badge on every verified resident's screen on every cold start, and would
  /// turn a connectivity problem into an accusation. The real boundary is
  /// `firestore.rules`, which rejects the write regardless of what this client
  /// believes; everything here is a courtesy that explains the refusal early.
  bool get locksReporting =>
      this == ResidentVerification.pending ||
      this == ResidentVerification.rejected;

  /// Headline for the lock dialog and the inline banner.
  String get lockHeadline => switch (this) {
        ResidentVerification.rejected => 'Account Not Approved',
        _ => 'Verification Pending',
      };

  /// Why the resident is being stopped, in their terms.
  ///
  /// ── NO CALL TO ACTION, BECAUSE THERE IS NOTHING TO DO ───────────────────
  /// This used to end in a button to a self-serve "Verify Your Property"
  /// screen. That screen is gone: verification is the HOA office's step now,
  /// worked on the admin dashboard against the address given at sign-up. A
  /// resident cannot move their own application along, so the copy stops at
  /// saying where it stands rather than offering a button whose only
  /// destination is somewhere else to wait.
  String get lockBody => switch (this) {
        ResidentVerification.rejected =>
          'The HOA office did not approve this account, so incident reports '
              'cannot be filed from it. Contact the HOA office to sort your '
              'registration out.',
        _ => 'Your account is currently under review by the HOA. You cannot '
            'submit or select incident categories until your account is '
            'verified.',
      };

  /// The read-only status badge for the profile and settings screens.
  String get badgeLabel => switch (this) {
        ResidentVerification.verified => 'HOA Verified',
        ResidentVerification.rejected => 'Not Approved',
        // `unknown` reads as pending here on purpose. A badge is a statement
        // about the ACCOUNT, and every account starts pending — unlike the
        // lock, which must not act on a status it has not actually read.
        _ => 'Pending HOA Approval',
      };
}

/// Feeds the resident's verification status to [builder] WITHOUT ever holding
/// up what it wraps.
///
/// ── WHY NOT AccountVerificationGate ─────────────────────────────────────────
/// The full-screen [AccountVerificationGate] renders a holding screen until its
/// first Firestore snapshot lands, which is why `/report` is deliberately not
/// wrapped in it (see the route table in `lib/app/app.dart`): on a slow or
/// unreachable connection tapping Report showed a near-empty gradient screen
/// indefinitely. This builder is the opposite shape — it always renders its
/// child immediately and simply reports what it knows so far, so the form
/// appears instantly and the lock settles onto it a frame later.
class VerificationStatusBuilder extends StatefulWidget {
  const VerificationStatusBuilder({super.key, required this.builder});

  final Widget Function(BuildContext context, ResidentVerification status)
      builder;

  @override
  State<VerificationStatusBuilder> createState() =>
      _VerificationStatusBuilderState();
}

class _VerificationStatusBuilderState extends State<VerificationStatusBuilder> {
  String? _uid;
  Stream<String>? _stream;

  @override
  void initState() {
    super.initState();
    // Resolved once. Rebuilding the stream on every build would open a fresh
    // Firestore listener each frame.
    _uid = FirebaseAuth.instance.currentUser?.uid;
    final uid = _uid;
    if (uid != null) _stream = AccountApprovalService.statusStream(uid);
  }

  static ResidentVerification _map(String? raw) => switch (raw) {
        ResidentStatus.verified => ResidentVerification.verified,
        ResidentStatus.pending => ResidentVerification.pending,
        ResidentStatus.rejected => ResidentVerification.rejected,
        _ => ResidentVerification.unknown,
      };

  @override
  Widget build(BuildContext context) {
    final stream = _stream;
    final uid = _uid;
    // Signed out. AuthGate owns that case; nothing to lock here.
    if (stream == null || uid == null) {
      return widget.builder(context, ResidentVerification.unknown);
    }

    return StreamBuilder<String>(
      stream: stream,
      // Seeded from the cache the app-wide gate already populated, so arriving
      // at this screen does not re-open a listener and wait.
      initialData: AccountApprovalService.cachedStatusFor(uid),
      builder: (context, snapshot) {
        // An errored stream is "we could not check", not "not verified".
        final status = snapshot.hasError ? null : snapshot.data;
        return widget.builder(context, _map(status));
      },
    );
  }
}

/// The modal shown when a locked control is tapped.
///
/// A dialog rather than one of this app's bottom sheets: a sheet is a drawer of
/// more options, and this is a refusal. It needs to sit in the middle of the
/// screen and be acknowledged.
Future<void> showVerificationRequiredDialog(
  BuildContext context,
  ResidentVerification status,
) {
  HapticFeedback.heavyImpact();
  return showDialog<void>(
    context: context,
    barrierDismissible: true,
    builder: (dialogContext) => _VerificationRequiredDialog(status: status),
  );
}

class _VerificationRequiredDialog extends StatelessWidget {
  const _VerificationRequiredDialog({required this.status});

  final ResidentVerification status;

  @override
  Widget build(BuildContext context) {
    final rejected = status == ResidentVerification.rejected;
    final tone = rejected ? AppColors.danger : AppColors.warning;

    return Dialog(
      backgroundColor: AppColors.backgroundElevated,
      insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.xl),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 24, 22, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(PhosphorIconsFill.lockSimple, size: 26, color: tone),
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: Text(
                status.lockHeadline,
                textAlign: TextAlign.center,
                style: sfPro(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.3,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              status.lockBody,
              textAlign: TextAlign.center,
              style: sfPro(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 20),
            // ONE button, and it only dismisses. There is no second thing a
            // resident can do about this from the app.
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: AppColors.onAccent,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                child: Text(
                  'Got it',
                  style: sfPro(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onAccent,
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

/// The inline alert that sits above a locked list.
///
/// Present so the lock is explained BEFORE anything is tapped. A resident who
/// only meets the reason after tapping a card they thought was live has already
/// been told "no" once for no reason.
class VerificationBanner extends StatelessWidget {
  const VerificationBanner({super.key, required this.status, this.onTap});

  final ResidentVerification status;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final rejected = status == ResidentVerification.rejected;
    final tone = rejected ? AppColors.danger : AppColors.warning;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.backgroundSecondary,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          // `border-slate-200` — neutral, not the alert's own hue. The tone is
          // carried by the icon and the CTA; a coloured border around a card
          // this wide reads as an error state for the whole screen.
          border: Border.all(
            color: AppColors.borderNeutral,
            width: AppStroke.card,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: tone.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(PhosphorIconsFill.lockSimple, size: 16, color: tone),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    status.lockHeadline,
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    status.lockBody,
                    style: sfPro(
                      fontSize: 11.5,
                      color: AppColors.textSecondary,
                      height: 1.4,
                    ),
                  ),
                  // No "go here to fix it" link. Verification is the HOA
                  // office's step; the banner's whole job is to say so.
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The read-only account-status pill for the profile and settings screens.
///
/// READ-ONLY, and that is the point. It replaced a row that opened a self-serve
/// "Verify Your Property" wizard. A resident has no lever here any more — the
/// HOA office verifies the address they gave at sign-up — so the honest control
/// is a statement, not a button dressed as one.
class VerificationStatusBadge extends StatelessWidget {
  const VerificationStatusBadge({super.key, required this.status});

  final ResidentVerification status;

  @override
  Widget build(BuildContext context) {
    final verified = status == ResidentVerification.verified;
    final rejected = status == ResidentVerification.rejected;
    final tone = verified
        ? AppColors.accentPrimary
        : rejected
            ? AppColors.danger
            : AppColors.warning;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: tone.withValues(alpha: 0.32)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            verified
                ? PhosphorIconsFill.sealCheck
                : PhosphorIconsFill.clockCountdown,
            size: 13,
            color: tone,
          ),
          const SizedBox(width: 5),
          Text(
            status.badgeLabel,
            style: sfPro(
              fontSize: 11.5,
              fontWeight: FontWeight.w800,
              color: tone,
              letterSpacing: -0.1,
            ),
          ),
        ],
      ),
    );
  }
}

/// The small lock chip that replaces a control's own trailing badge while the
/// account is locked.
class VerificationLockBadge extends StatelessWidget {
  const VerificationLockBadge({super.key, this.size = 24});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.borderNeutralSoft,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.borderNeutral),
      ),
      child: Icon(
        PhosphorIconsFill.lockSimple,
        size: size * 0.5,
        color: AppColors.textMuted,
      ),
    );
  }
}
