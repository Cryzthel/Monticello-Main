import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/auth/widgets/verification_lock.dart';
import 'package:monticello_villas_app/features/property/services/property_storage.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';
import 'package:monticello_villas_app/core/widgets/feed_skeletons.dart';

/// "Your Property": the address this account is registered to, and where the
/// HOA's review of it stands. Read-only — see the note on [_load].
///
/// ── THE REFERENCE LAYOUT, WITHOUT THE GREEN CARD (2026-10-18) ─────────────
/// Rebuilt from the user's reference screenshot: the LOCATION card with
/// Phase, Block and Lot as three tinted tiles, and the RESIDENCY card with
/// resident type and HOA status as labelled rows. The large green card that
/// sat above them is removed at the user's request, as is the explanatory
/// footer and its "Contact the HOA office" link — the directory lives in
/// Settings → HOA contacts.
///
/// Status comes from the HOA's actual decision, and nothing here edits.
class PropertyDetailsScreen extends StatefulWidget {
  const PropertyDetailsScreen({super.key});

  @override
  State<PropertyDetailsScreen> createState() => _PropertyDetailsScreenState();
}

class _PropertyDetailsScreenState extends State<PropertyDetailsScreen> {
  bool _loading = true;
  PropertyRecord? _record;
  Stream<String?>? _residentType;
  Stream<String?>? _rejectionReason;

  @override
  void initState() {
    super.initState();
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid != null) {
      // Opened once here, not in build, so a rebuild never opens a listener.
      _residentType = AccountApprovalService.residentTypeStream(uid);
      _rejectionReason = AccountApprovalService.rejectionReasonStream(uid);
    }
    // The home header has usually fetched this already: paint it at once and
    // refresh quietly, rather than spinning on data we probably hold.
    final cached = uid == null ? null : PropertyStorage.cachedFor(uid);
    if (cached != null) {
      _record = cached;
      _loading = false;
    }
    _load(silent: cached != null);
  }

  /// ── NOTHING HERE EDITS ──────────────────────────────────────────────────
  /// Phase, Block and Lot are what the HOA office verified this account
  /// against and what every report is routed by. Corrections go through the
  /// HOA office.
  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    final user = FirebaseAuth.instance.currentUser;
    final record =
        user == null ? null : await PropertyStorage.loadFullForUser(user.uid);
    if (!mounted) return;
    setState(() {
      _record = record;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: SizedBox(
                height: 44,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: ModernBackButton(),
                    ),
                    Text(
                      'Your Property',
                      textAlign: TextAlign.center,
                      style: sfPro(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: _loading
                  // The cards' own shapes, so nothing jumps when they land.
                  ? const PropertyDetailsSkeleton()
                  // The app's shared pull-to-refresh.
                  : RefreshShell(
                      onRefresh: () => _load(silent: true),
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                        children: _record == null
                            ? [const _NoPropertyCard()]
                            : _cards(_record!),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _cards(PropertyRecord r) {
    final street = r.street.trim();
    final unit = r.unit.trim();

    return [
      // ── LOCATION ──────────────────────────────────────────────────────
      _PropertyCard(
        children: [
          const _Caption('LOCATION'),
          Row(
            children: [
              Expanded(
                child: _FigureTile(
                  icon: PhosphorIconsFill.stack,
                  label: 'Phase',
                  value: r.phase,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _FigureTile(
                  icon: PhosphorIconsFill.gridFour,
                  label: 'Block',
                  value: r.block,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _FigureTile(
                  icon: PhosphorIconsFill.houseLine,
                  label: 'Lot',
                  value: r.lot,
                ),
              ),
            ],
          ),
          // Optional at sign-up, so only shown when there is something to
          // show — a row reading "Not set" teaches nothing.
          if (street.isNotEmpty) ...[
            const _Hairline(),
            _Row(
              icon: PhosphorIconsFill.signpost,
              label: 'Street / road',
              value: Text(street, style: _Row.valueStyle),
            ),
          ],
          if (unit.isNotEmpty) ...[
            const _Hairline(),
            _Row(
              icon: PhosphorIconsFill.door,
              label: 'Unit / house no.',
              value: Text(unit, style: _Row.valueStyle),
            ),
          ],
        ],
      ),
      const SizedBox(height: 14),

      // ── RESIDENCY ─────────────────────────────────────────────────────
      _PropertyCard(
        children: [
          const _Caption('RESIDENCY'),
          _Row(
            icon: PhosphorIconsFill.identificationBadge,
            label: 'Resident type',
            value: StreamBuilder<String?>(
              stream: _residentType,
              builder: (context, snap) => Text(
                snap.data == null
                    ? (snap.connectionState == ConnectionState.waiting
                        ? '—'
                        : 'Not recorded')
                    : ResidentType.label(snap.data!),
                style: _Row.valueStyle,
              ),
            ),
          ),
          const _Hairline(),
          _Row(
            icon: PhosphorIconsFill.sealCheck,
            label: 'HOA status',
            value: VerificationStatusBuilder(
              builder: (context, status) => _StatusPill(status: status),
            ),
          ),
          // The reason, when there is one, under the status it explains.
          StreamBuilder<String?>(
            stream: _rejectionReason,
            builder: (context, snap) {
              final reason = snap.data;
              if (reason == null) return const SizedBox.shrink();
              return VerificationStatusBuilder(
                builder: (context, status) =>
                    status != ResidentVerification.rejected
                        ? const SizedBox.shrink()
                        : Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.danger.withValues(alpha: 0.06),
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                            ),
                            child: Text(
                              reason,
                              style: sfPro(
                                fontSize: 13,
                                color: AppColors.dangerInk,
                                height: 1.45,
                              ),
                            ),
                          ),
              );
            },
          ),
        ],
      ),
    ];
  }
}

/// `rounded-2xl p-5`, a hairline border and a soft lift, on the app surface.
class _PropertyCard extends StatelessWidget {
  const _PropertyCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.backgroundSecondary,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: AuthTokens.border),
        boxShadow: AppShadows.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _Caption extends StatelessWidget {
  const _Caption(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: sfPro(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: AppColors.textMuted,
        letterSpacing: 0.9,
      ),
    );
  }
}

/// One of Phase / Block / Lot: a tinted tile, the name small with its glyph,
/// the number large.
class _FigureTile extends StatelessWidget {
  const _FigureTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label $value',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
        decoration: BoxDecoration(
          color: AppColors.accentPrimary.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(
              color: AppColors.accentPrimary.withValues(alpha: 0.14)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 14, color: AppColors.accentPrimary),
                const SizedBox(width: 5),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.accentPrimary,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: displayFont(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Hairline extends StatelessWidget {
  const _Hairline();

  @override
  Widget build(BuildContext context) =>
      const Divider(height: 1, thickness: 1, color: AuthTokens.border);
}

/// A glyph and label on the left, the value on the right.
///
/// The LABEL gives way when space is short, never the value: in the old
/// layout the label kept its width and the status pill was squeezed until it
/// read "Verified mem…", which is the one part of the row that matters.
class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final Widget value;

  static final TextStyle valueStyle = sfPro(
    fontSize: 15,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
  );

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 36),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.neutralIcon),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: sfPro(fontSize: 14.5, color: AppColors.textSecondary),
            ),
          ),
          const SizedBox(width: 12),
          value,
        ],
      ),
    );
  }
}

/// The HOA's actual decision, from `residents/{uid}.verificationStatus`.
///
/// An older screen claimed "Verified Resident" whenever a property record
/// existed — which sign-up writes for everyone — so applicants saw approval
/// days before the HOA had looked. This reads the real status.
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final ResidentVerification status;

  @override
  Widget build(BuildContext context) {
    final (String label, IconData icon, Color ink, Color fill) = switch (status) {
      ResidentVerification.verified => (
          'Verified member',
          PhosphorIconsFill.sealCheck,
          AppColors.successInk,
          AppColors.success,
        ),
      ResidentVerification.pending => (
          'Pending review',
          PhosphorIconsFill.hourglassHigh,
          AppColors.warningInk,
          AppColors.warning,
        ),
      ResidentVerification.rejected => (
          'Not approved',
          PhosphorIconsFill.warningCircle,
          AppColors.dangerInk,
          AppColors.danger,
        ),
      ResidentVerification.unknown => (
          'Checking…',
          PhosphorIconsFill.circle,
          AppColors.textMuted,
          AppColors.textMuted,
        ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: fill.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon,
              size: status == ResidentVerification.unknown ? 7 : 13,
              color: ink),
          const SizedBox(width: 5),
          Text(
            label,
            maxLines: 1,
            softWrap: false,
            style: sfPro(fontSize: 13, fontWeight: FontWeight.w700, color: ink),
          ),
        ],
      ),
    );
  }
}

class _NoPropertyCard extends StatelessWidget {
  const _NoPropertyCard();

  @override
  Widget build(BuildContext context) {
    return _PropertyCard(
      children: [
        const Icon(PhosphorIconsFill.houseLine,
            size: 28, color: AppColors.textMuted),
        Text(
          'No property linked yet',
          style: sfPro(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        Text(
          'The HOA office links your unit to this account once your '
          'registration has been checked. Nothing is needed from you.',
          style: sfPro(fontSize: 13.5, color: AppColors.textSecondary, height: 1.45),
        ),
      ],
    );
  }
}
