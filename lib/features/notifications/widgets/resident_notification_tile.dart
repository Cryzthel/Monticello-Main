import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';

/// Tabular figures, for anything read down a column — the timestamp badges.
/// Proportional digits make two stamps of equal length look unequal, which is
/// exactly wrong for a list scanned vertically.
const List<FontFeature> _tabular = [FontFeature.tabularFigures()];

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
  double letterSpacing = 0,
  double height = 1.35,
  List<FontFeature>? fontFeatures,
}) {
  return sfPro(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
    fontFeatures: fontFeatures,
  );
}

/// Absolute, not relative — "2h ago" is right for a feed you skim and wrong
/// for a security record you may have to recount to the guardhouse.
/// `14 Jul 09:12` is the same width for every value in a year, so the badge
/// column does not jag down the list.
String formatAlertStamp(DateTime t) => DateFormat('d MMM HH:mm').format(t.toLocal());

/// The three-dot overflow on a notification tile.
///
/// The SECOND route to delete, beside the swipe. A swipe is fast and completely
/// invisible — nothing on a card advertises it — so a discoverable control has
/// to exist alongside it or the gesture is only available to people who already
/// know it is there. This one is also the only route available to a resident
/// using a screen reader or switch control.
/// Actions the overflow menu can return.
///
/// A real value, NOT `PopupMenuItem<void>` with a null value. PopupMenuButton
/// routes a null result to `onCanceled`, not `onSelected` — it cannot tell
/// "picked the only item" from "tapped outside" — so a null-valued item builds
/// and opens and looks correct while being permanently inert.
enum _TileAction { delete }

class _OverflowMenu extends StatelessWidget {
  const _OverflowMenu({required this.onDelete});

  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<_TileAction>(
      tooltip: 'Notification options',
      padding: EdgeInsets.zero,
      // The tile is a dense row; the button's own 48px minimum would push the
      // stamp column out. Constrained tight and given its own hit padding via
      // the icon's box instead.
      constraints: const BoxConstraints(minWidth: 184),
      splashRadius: 18,
      color: AppColors.backgroundElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        side: const BorderSide(color: AppColors.borderNeutral),
      ),
      icon: const Icon(PhosphorIconsBold.dotsThreeVertical,
          size: 16, color: AppColors.textMuted),
      onSelected: (action) {
        if (action == _TileAction.delete) onDelete();
      },
      itemBuilder: (context) => [
        PopupMenuItem<_TileAction>(
          height: 42,
          value: _TileAction.delete,
          child: Row(
            children: [
              const Icon(PhosphorIconsFill.trash,
                  size: 15, color: AppColors.danger),
              const SizedBox(width: 10),
              Text(
                'Delete Notification',
                style: _t(
                  size: 13,
                  weight: FontWeight.w600,
                  color: AppColors.danger,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// A small filled capsule. Every piece of metadata on a tile is one of these,
/// which keeps the row reading as a set rather than as unrelated scraps.
class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.label, required this.color, this.icon});

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    // The wash stays the bright hue; the glyph and the label step down to its
    // ink. [color] arrives here straight from `_statusColor`, so a pending
    // chip was painting amber-500 text on a 10% amber wash — 1.99:1, the
    // faintest text on the tile, on the chip that says whether anyone has
    // looked at the resident's report yet. Every status ink clears 6.4:1.
    //
    // `textSecondary`, this chip's other caller, has no ink partner and comes
    // back unchanged; it already measures 6.53:1.
    final ink = AppColors.inkFor(color);
    return Container(
      padding: EdgeInsets.fromLTRB(icon == null ? 8 : 6, 3, 8, 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        // Pills, against the card's 14px frame. The contrast is the point:
        // metadata reads as discrete tokens, the card reads as a panel.
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: ink),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: _t(
              size: 10.5,
              weight: FontWeight.w700,
              color: ink,
              letterSpacing: 0.1,
              height: 1.1,
            ),
          ),
        ],
      ),
    );
  }
}

/// The leading avatar: WHO acted, with a small badge for WHAT they did —
/// Instagram's activity-row shape.
///
/// A report alert shows the responder's initials once a guard is named, and
/// the guardhouse shield before that; an announcement shows the HOA's
/// megaphone and no badge (the avatar already is the activity). The badge
/// carries the event glyph on the event's own tint, ringed in the card colour
/// so it reads as sitting on top of the avatar rather than touching it.
class _ActivityAvatar extends StatelessWidget {
  const _ActivityAvatar({required this.notification});

  final ResidentNotification notification;

  static const double size = 40;
  static const double _badge = 18;

  static String _initials(String name) {
    final parts = name
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty && RegExp(r'[A-Za-z]').hasMatch(p[0]))
        .toList();
    if (parts.isEmpty) return '';
    final first = parts.first[0];
    final last = parts.length > 1 ? parts.last[0] : '';
    return (first + last).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final n = notification;
    final initials =
        n.isAnnouncement ? '' : _initials(n.guardName.trim());

    final Widget face;
    if (n.isAnnouncement) {
      face = Icon(PhosphorIconsFill.megaphone, size: 18, color: n.tint);
    } else if (initials.isNotEmpty) {
      face = Text(
        initials,
        style: _t(
          size: 13.5,
          weight: FontWeight.w700,
          color: AppColors.textPrimary,
          letterSpacing: 0.2,
          height: 1,
        ),
      );
    } else {
      face = const Icon(PhosphorIconsFill.shieldCheck,
          size: 18, color: AppColors.textSecondary);
    }

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: n.isAnnouncement
                  ? n.tint.withValues(alpha: 0.12)
                  : AppColors.backgroundSecondary,
              border: Border.all(color: AppColors.borderNeutral),
            ),
            child: face,
          ),
          if (!n.isAnnouncement)
            Positioned(
              right: -3,
              bottom: -3,
              child: Container(
                width: _badge,
                height: _badge,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: n.tint,
                  border:
                      Border.all(color: AppColors.background, width: 2),
                ),
                child: Icon(n.icon, size: 9, color: AppColors.onAccent),
              ),
            ),
        ],
      ),
    );
  }
}

/// The unread mark beside the timestamp: an emerald dot with a soft halo.
///
/// Fades and shrinks out (160ms ease-out) rather than vanishing, so the tap
/// that read the row visibly does something. Width animates to zero with it,
/// so the timestamp slides back flush instead of leaving a gap.
class _UnreadDot extends StatelessWidget {
  const _UnreadDot({required this.visible});

  final bool visible;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      width: visible ? 14 : 0,
      alignment: Alignment.centerLeft,
      child: AnimatedScale(
        scale: visible ? 1 : 0.4,
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        child: AnimatedOpacity(
          opacity: visible ? 1 : 0,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
          child: Semantics(
            label: visible ? 'Unread' : null,
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.45),
                    blurRadius: 6,
                    spreadRadius: 1,
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

/// One alert, as a tile that opens in full.
///
/// ── TAP OPENS THIS ALERT, NOT A LIST ──────────────────────────────────────
/// [onTap] opens the alert's own detail modal (see `showNotificationDetail`):
/// an announcement alert opens the announcement, a report alert opens its
/// full text, exact time, status and responder. That keeps the promise a tap
/// makes. An early version navigated every tile to `/incidents` — the whole
/// report list — whichever report the alert was about, and for a while after
/// that the tiles were deliberately inert rather than keep that broken link.
///
/// STRUCTURE, top to bottom:
///
///   [glyph]  HEADLINE (bold)                       · timestamp badge
///            one line of detail
///            [status pill] [guard tag]
///
/// Announcement alerts carry neither chip — an announcement has no lifecycle
/// and no responder — so their metadata row collapses away entirely rather
/// than rendering two empty capsules.
class ResidentNotificationTile extends StatelessWidget {
  const ResidentNotificationTile({
    super.key,
    required this.notification,
    this.onDelete,
    this.onTap,
    this.unread = false,
  });

  final ResidentNotification notification;

  /// Supplied by the drawer. Null renders the tile without an overflow menu —
  /// which is what any other surface reusing this tile should get, since
  /// dismissal only means something where the dismissed list is read.
  final VoidCallback? onDelete;

  /// Opens the alert in full. Null renders an inert tile.
  final VoidCallback? onTap;

  /// Arrived since the drawer was last opened and not yet tapped. Tints the
  /// card AND lights a dot beside the timestamp: the tint is what reads at a
  /// glance down the list, the dot is what a resident looks for on one row
  /// (and what a screen reader announces). Tapping the row clears both.
  final bool unread;

  @override
  Widget build(BuildContext context) {
    final statusLabel = notification.statusLabel;
    final hasMeta = statusLabel != null || !notification.isAnnouncement;

    // ── A ROW, NOT A CARD ───────────────────────────────────────────────────
    // No border, no shadow, no surface: an activity feed reads as one list,
    // and a stack of bordered cards read as forty separate objects. The only
    // fill a row ever carries is the unread wash, edge to edge, which fades
    // out (180ms ease-out) the moment the row is read — so the tap visibly
    // does what it says.
    //
    // Press feedback is a faint highlight, no ripple. A ripple across a
    // full-width row is a lot of motion for "open this".
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        color: unread ? AppColors.surfaceAccentSoft : Colors.transparent,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          splashFactory: NoSplash.splashFactory,
          highlightColor: AppColors.textPrimary.withValues(alpha: 0.04),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: _body(statusLabel, hasMeta),
          ),
        ),
      ),
    );
  }

  Widget _body(String? statusLabel, bool hasMeta) {
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ActivityAvatar(notification: notification),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      notification.headline,
                      style: _t(
                        size: 14,
                        weight: FontWeight.w700,
                        color: AppColors.textPrimary,
                        letterSpacing: -0.15,
                        height: 1.25,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                    Text(
                      notification.detail,
                      style: _t(
                        size: 12,
                        color: AppColors.textSecondary,
                        height: 1.4,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // Pinned to the headline's baseline rather than the row's centre:
              // the tile's height varies with how far the detail line wraps,
              // and a vertically-centred stamp would drift up and down the
              // column as it did.
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _UnreadDot(visible: unread),
                        Text(
                      formatAlertStamp(notification.at),
                      style: _t(
                        size: 10.5,
                        weight: FontWeight.w600,
                        color: AppColors.textMuted,
                        height: 1.2,
                        fontFeatures: _tabular,
                      ),
                    ),
                      ],
                    ),
                    if (onDelete != null) _OverflowMenu(onDelete: onDelete!),
                  ],
                ),
              ),
            ],
          ),
          if (hasMeta) ...[
            const SizedBox(height: 11),
            Padding(
              padding: const EdgeInsets.only(left: _ActivityAvatar.size + 12),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  if (statusLabel != null)
                    _MetaChip(
                      label: statusLabel,
                      color: notification.statusColor ?? AppColors.textSecondary,
                    ),
                  if (!notification.isAnnouncement)
                    _MetaChip(
                      label: notification.guardTag,
                      color: AppColors.textSecondary,
                      icon: PhosphorIconsFill.shieldCheck,
                    ),
                ],
              ),
            ),
          ],
        ],
    );
  }
}
