import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/glass_container.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/features/media/widgets/media_viewer.dart';

/// ─────────────────────── SCREEN HEADER ───────────────────────
/// Unified page header used across every screen for consistent hierarchy.
/// Always renders the same: eyebrow label → title → subtitle, with an optional
/// trailing action slot. When [showBack] is true a glass back button is shown.
class ScreenHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? eyebrow;
  final Widget? trailing;
  final bool showBack;

  const ScreenHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.eyebrow,
    this.trailing,
    this.showBack = false,
  });

  @override
  Widget build(BuildContext context) {
    final secondary = AppColors.textSecondary;
    final onSurface = AppColors.textPrimary;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (showBack) ...[
                const ModernBackButton(),
                const SizedBox(width: AppSpacing.md),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (eyebrow != null) ...[
                      Text(
                        eyebrow!.toUpperCase(),
                        style: AppText.overline.copyWith(color: secondary),
                      ),
                      const SizedBox(height: 6),
                    ],
                    Text(
                      title,
                      style: AppText.headline.copyWith(
                        color: onSurface,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: AppSpacing.sm),
                trailing!,
              ],
            ],
          ),
          if (subtitle != null) ...[
            const SizedBox(height: AppSpacing.xs + 2),
            Padding(
              padding: EdgeInsets.only(left: showBack ? 52 : 0),
              child: Text(
                subtitle!,
                style: AppText.body.copyWith(color: secondary),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// ─────────────────────── SECTION HEADER ───────────────────────
/// Used between groups of content within a scroll view for consistent hierarchy.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? action;
  final VoidCallback? onAction;
  final IconData? icon;

  const SectionHeader({
    super.key,
    required this.title,
    this.action,
    this.onAction,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final accent = AppColors.primary;
    final titleColor = AppColors.textPrimary;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: AppIconSize.sm - 2, color: accent),
            const SizedBox(width: AppSpacing.sm),
          ],
          Expanded(
            child: Text(
              title,
              style: AppText.title.copyWith(
                letterSpacing: 0.2,
                color: titleColor,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (action != null)
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: accent,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                minimumSize: const Size(0, 28),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(action!, style: sfPro(fontSize: 12.5, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 2),
                  const Icon(AppIcons.chevronRight, size: 14),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// ─────────────────────── PRIMARY BUTTON ───────────────────────
class PrimaryButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool loading;
  final bool expanded;
  final Color? color;

  const PrimaryButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.loading = false,
    this.expanded = true,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    // #047857 (emerald-700), not ctaGreen's #16A34A.
    //
    // The label sets at 15px/w600, which is under every WCAG threshold for
    // "large text", so it owes the full 4.5:1. White on #16A34A measures
    // 3.30:1 and does not pay it; white on #047857 measures 5.48:1 and does.
    //
    // The comment that used to sit here asserted the opposite — that the fill
    // was a "bright seafoam" needing dark text on it, and that white "would
    // fail contrast". That stopped describing the code once `background`
    // became #FFFFFF and `ctaGreen` became a mid-depth emerald: `foreground`
    // resolves to white, so this button has been painting white-on-green the
    // whole time, which is exactly what the comment claimed to be avoiding.
    //
    // #047857 is also the web portal's `--color-brand-cta`, so the two
    // products' primary buttons now land on one value instead of two.
    final green = AppColors.primaryDark;
    const foreground = AppColors.background;
    final btn = ElevatedButton(
      onPressed: loading ? null : withKeyboardDismissed(onPressed),
      style: ElevatedButton.styleFrom(
        backgroundColor: color ?? green,
        disabledBackgroundColor: (color ?? green).withValues(alpha: 0.45),
        foregroundColor: foreground,
        elevation: 0,
        shadowColor: Colors.transparent,
        minimumSize: const Size(0, 54),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
      ).merge(
        ButtonStyle(
          overlayColor: WidgetStateProperty.resolveWith(
            (_) => foreground.withValues(alpha: 0.10),
          ),
        ),
      ),
      child: loading
          ? const LeafLoader(size: 20, color: foreground)
          : Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18),
                  const SizedBox(width: AppSpacing.sm),
                ],
                Text(label, style: AppText.button),
              ],
            ),
    );
    final glowing = !(loading || onPressed == null);
    final wrappedGlow = glowing
        ? DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.md),
              // NEUTRAL, and one layer instead of two.
              //
              // This was the worst offender in the app: a DOUBLE glow in the
              // button's own colour, 42% over 36% blur plus 20% over a wider
              // 36px blur, stacked to fake a bloom. On the primary CTA — the
              // widest element on most screens — that painted a green cloud
              // across the bottom of the page, and it was reproduced under
              // every secondary button that passed a `color`.
              boxShadow: AppShadows.md,
            ),
            child: btn,
          )
        : btn;
    return expanded ? SizedBox(width: double.infinity, child: wrappedGlow) : wrappedGlow;
  }
}

/// ─────────────────────── GHOST BUTTON ───────────────────────
class GhostButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expanded;

  const GhostButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.expanded = true,
  });

  @override
  Widget build(BuildContext context) {
    final fg = AppColors.textPrimary;
    final edge = AppColors.innerStroke;

    final btn = OutlinedButton(
      onPressed: withKeyboardDismissed(onPressed),
      style: OutlinedButton.styleFrom(
        foregroundColor: fg,
        side: BorderSide(color: edge),
        backgroundColor: AppColors.surface,
        minimumSize: const Size(0, 52),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: 12,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 18),
            const SizedBox(width: AppSpacing.sm),
          ],
          Text(label,
              style: AppText.button.copyWith(color: fg)),
        ],
      ),
    );
    return expanded ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}

/// ─────────────────────── STATUS CHIP ───────────────────────
/// A compact label pill — used on cards to show state (Pending, Resolved).
class StatusChip extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;

  const StatusChip({
    super.key,
    required this.label,
    required this.color,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: sfPro(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: color,
              letterSpacing: 0.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// ─────────────────────── BADGE PILL ───────────────────────
/// Generic outlined pill badge with an optional icon — for category tags,
/// filters and short metadata labels.
class BadgePill extends StatelessWidget {
  final String label;
  final IconData? icon;
  final Color color;
  final bool solid;

  const BadgePill({
    super.key,
    required this.label,
    this.icon,
    this.color = AppColors.textSecondary,
    this.solid = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: solid ? color.withValues(alpha: 0.2) : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: color.withValues(alpha: solid ? 0.45 : 0.22)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: sfPro(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// ─────────────────────── QUICK ACTION TILE ───────────────────────
/// Grid tile used on the home dashboard.
class QuickActionTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? sublabel;
  final Color accent;
  final VoidCallback? onTap;

  const QuickActionTile({
    super.key,
    required this.icon,
    required this.label,
    required this.accent,
    this.sublabel,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.cardPadding),
      borderRadius: AppRadius.lg,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Icon(icon, color: accent, size: AppIconSize.md - 2),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            label,
            style: AppText.bodyStrong.copyWith(fontSize: 13.5),
          ),
          if (sublabel != null) ...[
            const SizedBox(height: 2),
            Text(
              sublabel!,
              style: AppText.caption.copyWith(fontSize: 11),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}

/// ─────────────────────── STAT CARD ───────────────────────
/// Compact statistic card — used in dashboard overview rows.
class StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color accent;
  final String? trend;

  const StatCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
    this.trend,
  });

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      padding: const EdgeInsets.all(AppSpacing.cardPadding),
      borderRadius: AppRadius.md,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 16, color: accent),
              ),
              const Spacer(),
              if (trend != null)
                Text(
                  trend!,
                  style: sfPro(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: accent,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            value,
            style: AppText.title.copyWith(fontSize: 20),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: AppText.caption,
          ),
        ],
      ),
    );
  }
}

/// ─────────────────────── INFO TILE ───────────────────────
/// Horizontal row with leading icon, title, subtitle, and optional trailing.
class InfoTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  const InfoTile({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.iconColor = AppColors.info,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.cardPadding),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: iconColor, size: AppIconSize.md - 2),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.bodyStrong),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: AppText.caption,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: AppSpacing.sm),
            trailing!,
          ] else if (onTap != null)
            const Icon(AppIcons.chevronRight, color: AppColors.textMuted, size: 20),
        ],
      ),
    );
  }
}

/// ─────────────────────── SEGMENTED CONTROL ───────────────────────
/// A closed choice over one list — History's All · Active · Resolved.
///
/// ── WHY THIS AND NOT A CHIP ROW ───────────────────────────────────────────
/// A chip row says "zero or more of many". Its options are a set that can grow,
/// it scrolls because it does not expect to fit, and nothing about its shape
/// promises the options are mutually exclusive — separate pills on a rail read
/// as toggles that happen to be adjacent. A segmented control says "exactly one
/// of these few": a single track, split into a fixed number of parts, with one
/// indicator that MOVES between them.
///
/// The movement is what carries the meaning. Two pills swapping fill colour is
/// two independent state changes the eye has to associate; one thumb sliding
/// from Active to Resolved is a single continuous object, and it says "this
/// control changed which of its parts is on" without any inference.
///
/// ── ONE SLIDING THUMB, LABELS DRAWN OVER IT ───────────────────────────────
/// The previous implementation here animated a per-segment `AnimatedContainer`
/// — every segment tweening its own fill, which is the chip-row behaviour in a
/// box. There is one thumb now, positioned by [AnimatedPositioned] against a
/// width measured by [LayoutBuilder], and the labels sit ABOVE it in the stack
/// rather than inside it. A label riding the indicator would have to fade two
/// copies of itself past each other mid-slide; this way the text holds still
/// and only its colour crosses over as the fill arrives underneath.
class SegmentedControl extends StatelessWidget {
  final List<String> segments;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  /// Continuous thumb position in segment units — 1.5 sits the thumb exactly
  /// between the second and third segments. Drive it from a `PageController`
  /// to make the indicator track a swipe frame by frame.
  ///
  /// ── WHY A LISTENABLE AND NOT A double ─────────────────────────────────────
  /// A page drag produces a new position on every frame. Passing that down as
  /// a plain value would mean the owning screen calling `setState` sixty times
  /// a second, rebuilding the whole History feed — hundreds of widgets — to
  /// move one pill a few pixels. As a [ValueListenable] only the thumb and the
  /// three labels rebuild, which is the same trick [SwipeToDelete] uses to
  /// keep a drag off the widget tree.
  ///
  /// Null falls back to animating between whole [selectedIndex] values, which
  /// is what a control with no pager behind it wants.
  final ValueListenable<double>? position;

  const SegmentedControl({
    super.key,
    required this.segments,
    required this.selectedIndex,
    required this.onChanged,
    this.position,
  });

  /// 44 outer / 36 inner: the inner segment clears Material's 36px minimum for
  /// a compact control, and the 4px inset is what makes the track read as a
  /// groove the thumb sits IN rather than a border drawn around it.
  static const double height = 44;
  static const double _inset = 4;

  static const Duration slide = Duration(milliseconds: 280);

  @override
  Widget build(BuildContext context) {
    // Guarded rather than assumed: an out-of-range index would put the thumb
    // off the end of the track, or negative-position it out of layout.
    final index = selectedIndex.clamp(0, segments.length - 1);
    final last = (segments.length - 1).toDouble();

    return Container(
      height: height,
      padding: const EdgeInsets.all(_inset),
      decoration: BoxDecoration(
        // Slate-100. The track has to be a shade the thumb can be seen
        // travelling across; on the app's pure-white canvas an untinted one
        // would leave the emerald pill floating with no visible rail.
        color: AppColors.neutralFill,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final segmentWidth = constraints.maxWidth / segments.length;
          final tracker = position;

          if (tracker == null) {
            return _track(segmentWidth, index.toDouble(), index,
                animated: true);
          }

          return ValueListenableBuilder<double>(
            valueListenable: tracker,
            builder: (context, value, _) {
              final at = value.clamp(0.0, last);
              // NOT animated while tracking. An implicit animation on a value
              // that is already changing every frame lags the finger by its own
              // duration — the thumb would trail the page instead of moving
              // with it. The pager's own settle animation is the easing here.
              //
              // Labels flip at the halfway mark rather than when the page
              // settles, so the text under the thumb is never the wrong colour
              // against the fill that has already arrived beneath it.
              return _track(segmentWidth, at, at.round(), animated: false);
            },
          );
        },
      ),
    );
  }

  Widget _track(
    double segmentWidth,
    double at,
    int active, {
    required bool animated,
  }) {
    final thumb = DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.accentPrimary,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        boxShadow: AppShadows.sm,
      ),
    );

    return Stack(
      fit: StackFit.expand,
      children: [
        if (animated)
          AnimatedPositioned(
            duration: slide,
            // Decelerating, not symmetric: the thumb should arrive settled
            // rather than ease into its destination, which is what makes a
            // 280ms travel feel instant instead of slow.
            curve: Curves.easeOutCubic,
            left: at * segmentWidth,
            width: segmentWidth,
            top: 0,
            bottom: 0,
            child: thumb,
          )
        else
          Positioned(
            left: at * segmentWidth,
            width: segmentWidth,
            top: 0,
            bottom: 0,
            child: thumb,
          ),
        Row(
          children: [
            for (var i = 0; i < segments.length; i++)
              Expanded(
                child: _Segment(
                  label: segments[i],
                  selected: i == active,
                  onTap: () {
                    if (i == selectedIndex) return;
                    HapticFeedback.selectionClick();
                    onChanged(i);
                  },
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// One segment's tap target and label.
class _Segment extends StatelessWidget {
  const _Segment({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        // `opaque` so the full segment is the target, not just the glyphs.
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Center(
          // Crossfades weight and colour over the same window the thumb takes
          // to arrive. Snapping the text at the moment of the tap would beat
          // the fill to the segment and read as two separate events.
          child: AnimatedDefaultTextStyle(
            duration: SegmentedControl.slide,
            curve: Curves.easeOutCubic,
            style: sfPro(
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
              color: selected ? AppColors.onAccent : AppColors.textSecondary,
              letterSpacing: selected ? 0.1 : 0,
              height: 1.35,
            ),
            child: Text(label),
          ),
        ),
      ),
    );
  }
}

/// ─────────────────────── ASYMMETRIC ICON PILL ───────────────────────
/// Soft geometric enclosure for active/highlighted icon states — replaces
/// generic circular or square badges. One diagonal (top-left/bottom-right)
/// is fully rounded into a stadium curve while the other diagonal
/// (top-right/bottom-left) stays a tight squircle, giving the container an
/// asymmetric, hand-tuned silhouette instead of a perfectly uniform pill.
class AsymmetricIconPill extends StatelessWidget {
  final Widget child;
  final Color background;
  final double width;
  final double height;
  final Border? border;

  const AsymmetricIconPill({
    super.key,
    required this.child,
    required this.background,
    this.width = 40,
    this.height = 32,
    this.border,
  });

  @override
  Widget build(BuildContext context) {
    final primaryRadius = Radius.circular(height);
    final secondaryRadius = Radius.circular(height * 0.3);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
      width: width,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: background,
        border: border,
        borderRadius: BorderRadius.only(
          topLeft: primaryRadius,
          bottomRight: primaryRadius,
          topRight: secondaryRadius,
          bottomLeft: secondaryRadius,
        ),
      ),
      child: child,
    );
  }
}

/// ─────────────────────── EMPTY STATE ───────────────────────
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GlassContainer(
              width: 72,
              height: 72,
              borderRadius: AppRadius.lg,
              padding: EdgeInsets.zero,
              variant: GlassVariant.subtle,
              child: Icon(icon, size: 32, color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(title, style: AppText.subtitle, textAlign: TextAlign.center),
            if (subtitle != null) ...[
              const SizedBox(height: 6),
              Text(
                subtitle!,
                style: AppText.body,
                textAlign: TextAlign.center,
              ),
            ],
            if (action != null) ...[
              const SizedBox(height: AppSpacing.md),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// ─────────────────────── GLASS TEXT FIELD ───────────────────────
/// Labeled text field built for the glass aesthetic.
class GlassTextField extends StatelessWidget {
  final String label;
  final String? hint;
  final IconData? icon;
  final TextEditingController? controller;
  final bool obscureText;
  final TextInputType? keyboardType;
  final int? maxLines;
  final String? Function(String?)? validator;

  const GlassTextField({
    super.key,
    required this.label,
    this.hint,
    this.icon,
    this.controller,
    this.obscureText = false,
    this.keyboardType,
    this.maxLines = 1,
    this.validator,
  });

  @override
  Widget build(BuildContext context) {
    final secondary = AppColors.textSecondary;
    final muted = AppColors.textMuted;
    final fg = AppColors.textPrimary;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: sfPro(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: secondary,
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          obscureText: obscureText,
          obscuringCharacter: AppInput.obscuringCharacter,
          keyboardType: keyboardType,
          maxLines: obscureText ? 1 : maxLines,
          validator: validator,
          style: sfPro(color: fg, fontSize: 14.5, fontWeight: AppInput.weight, letterSpacing: obscureText ? AppInput.obscuredSpacing : null),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: icon != null
                ? Icon(icon, size: 18, color: muted)
                : null,
          ),
        ),
      ],
    );
  }
}

/// ─────────────────────── REPORT STATUS TRACKER ───────────────────────
/// The horizontal four-step progress rail on a History card.
///
/// ── HOW MANY STEPS ARE DONE ───────────────────────────────────────────────
/// [IncidentStatusTracking.trackingStep] answers "which step is the report ON",
/// which is NOT the same question as "how many are finished", and reading one
/// as the other is what left a resolved report showing three checks and a live
/// step 4. `resolved` maps to step 3 — the last index — so under `idx < step`
/// the final node was permanently the ACTIVE one: a filled circle with the
/// numeral 4 in it, sitting there indefinitely on a report that was closed
/// weeks ago. The timeline never visibly completed.
///
/// So the two are computed separately. [_completed] is the count of finished
/// steps, and for a terminal state that is all four; `trackingStep` still marks
/// the live node, and a report that has completed has no live node at all.
///
/// `falseAlarm` is terminal but does NOT complete, and needs both halves of
/// that to be drawn right. It shares step 3 with `resolved`, but a report
/// withdrawn as a mistake did not travel the four stages — completing it would
/// claim a resolution that never happened — and it is not working through the
/// fourth either, so the step is neither done nor live. It renders as what it
/// is: three steps behind it and a pending fourth that will never fill.
class ReportStatusTracker extends StatelessWidget {
  final IncidentStatus status;

  const ReportStatusTracker({super.key, required this.status});

  static const _labels = ['Submitted', 'Verified', 'In Progress', 'Resolved'];

  static const _stepCount = 4;

  // ── ONE SET OF NUMBERS, NO PER-CARD OVERRIDES ────────────────────────────
  //
  // Every dimension of this rail is fixed here. It is the same indicator on
  // every card in a scrolling feed, and a feed is exactly where a few pixels
  // of drift between neighbours is visible — the eye reads a column of rails
  // against each other, not against a spec.

  /// Diameter of one step node. Read by the rail geometry as well as the discs
  /// themselves — see [build] — so the two cannot disagree about how much of a
  /// step column the node occupies.
  static const double _nodeSize = 26;

  /// Thickness of the rail running between two nodes.
  ///
  /// Two, not 2.5. A half-pixel rule lands on a fractional device pixel at
  /// every common ratio (7.5 physical px at 3x), so it is anti-aliased into a
  /// soft three-pixel smear instead of a crisp line — on the one element in
  /// this widget whose whole job is to be a clean straight edge.
  static const double _railHeight = 2;

  /// Clearance between a node's edge and the rail that runs into it.
  static const double _railInset = 4;

  /// The block's own vertical margin inside a card.
  ///
  /// Fixed, not a constructor argument. It used to be `verticalPadding + 6`,
  /// where the argument defaulted to 4 and the History card passed 10 — so the
  /// rail's vertical rhythm depended on which call site built it, and on a
  /// hidden +6 that was invisible from the call. One number, on the 8px grid.
  static const double _blockPadding = 16;

  /// Gap between the node row and the label row beneath it.
  static const double _labelGap = 8;

  /// Stroke weight of the check inside a completed node.
  ///
  /// Stated rather than inherited: [CheckmarkPainter]'s default is a ratio
  /// tuned for the report wizard's large confirmation badge, and at 26px it
  /// resolves to 2.9px — a tick that thick inside a disc this small closes up
  /// its own inner angle and reads as a smudge.
  static const double _checkStroke = 2.4;

  /// Number of steps behind the resident, 0–4. Only a report that ran the
  /// full course has four — see [IncidentLifecycle].
  int get _completed => status.isComplete ? _stepCount : status.trackingStep;

  /// The step currently underway, or null once nothing is.
  int? get _live => status.isTerminal ? null : status.trackingStep;

  /// One step's disc.
  ///
  /// ── NOTHING BUT A DISC ────────────────────────────────────────────────────
  ///
  /// Every node used to carry `border: 2px` regardless of state, and on a done
  /// node that border was drawn in the SAME emerald as the fill — 2px of colour
  /// outside 20px of the identical colour, which did nothing but grow the dot
  /// and coarsen the check inside it. Worse, it was a stroke on a card that has
  /// none, so four little outlined boxes marched across an otherwise borderless
  /// surface.
  ///
  /// A completed step is exactly one thing: a solid emerald disc with a white
  /// check. The ring survives only where it is load-bearing — a PENDING node,
  /// which is an empty circle on white and would not exist without its edge.
  ///
  /// ── THE CHECK IS PAINTED, NOT A GLYPH ─────────────────────────────────────
  ///
  /// It was `Icon(PhosphorIconsFill.check)`, and an [Icon] is text: it asks the
  /// font stack for one character and draws whatever comes back. When an icon
  /// font has not resolved, what comes back is the missing-glyph box — a hollow
  /// SQUARE, drawn in the icon's colour, sitting inside the circle. That is the
  /// one way a square could still appear here after the container behind these
  /// nodes was removed, and it is not a possibility worth leaving open on the
  /// History screen's most-read indicator.
  ///
  /// [CheckmarkPainter] is a path, so it cannot fail that way. It is also
  /// already what the report wizard's step indicator draws, which makes the two
  /// step trackers in this app agree on what a completed step looks like
  /// instead of merely resembling one another.
  ///
  /// Sized to fill the disc, DELIBERATELY: [CheckmarkPainter] insets its own
  /// tick to the middle ~50% of the box it is given, so painting at the full
  /// 26px node diameter is what produces a ~13px check with clearance all
  /// round. The box is stated on the CustomPaint rather than inherited from
  /// the parent's tight constraints, so resizing the node resizes the mark
  /// with it instead of silently rescaling one and not the other.
  ///
  /// [CheckmarkPainter.boundsFor] measures what that actually puts on the
  /// canvas, and a test holds those bounds inside the disc.
  Widget _stepNode(int index) {
    final isDone = index < _completed;
    final isActive = index == _live;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOut,
      width: _nodeSize,
      height: _nodeSize,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isDone
            ? AppColors.ctaGreen
            : (isActive ? AppColors.primary : AppColors.surface),
        border: isDone || isActive
            ? null
            : Border.all(color: AppColors.borderNeutralStrong, width: 1.5),
        // Neutral — see AppShadows. Was the active colour at 30%.
        boxShadow: isActive ? AppShadows.sm : null,
      ),
      child: isDone
          ? Center(
              child: CustomPaint(
                size: const Size.square(_nodeSize),
                painter: CheckmarkPainter(
                  color: AppColors.onAccent,
                  // Fully drawn. The stroke-on animation belongs to the wizard,
                  // where a step completes under the resident's eyes; here it
                  // would replay on every card that scrolls back into view.
                  progress: 1,
                  strokeWidth: _checkStroke,
                ),
              ),
            )
          : Center(
              child: Text(
                '${index + 1}',
                style: sfPro(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: isActive ? AppColors.onAccent : AppColors.textMuted,
                ),
              ),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // ── ONE COLUMN PER STEP, NOT NODES-AND-GAPS ──────────────────────────────
    //
    // The rail was laid out as `node, Expanded(rail), node, …` while the labels
    // underneath were four equal [Expanded] cells. Those are two different
    // grids and they do not line up: the discs are fixed-width and the gaps
    // absorb every pixel of slack, so on a width W the node centres fall at
    // 13, W/3 + 4.3, 2W/3 − 4.3 and W − 13, while the label cells centre at
    // W/8, 3W/8, 5W/8 and 7W/8. The two middle labels sat ~8px off the nodes
    // they name, and the outer two were aligned to the CARD's edge rather than
    // to a node — "Submitted" started 13px to the left of the disc above it.
    //
    // Both rows now derive from one number: the width cut into four equal step
    // columns. The disc is centred in its column and the label is centred in
    // the same column, so a label sitting under its own node is a consequence
    // of the layout instead of a coincidence maintained by hand.
    //
    // The rails span BETWEEN column centres, which is why they are positioned
    // rather than laid out in the row: a rail belongs to the gap between two
    // steps, and a gap is not a step.
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: _blockPadding),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final column = constraints.maxWidth / _stepCount;
          double centreOf(int step) => column * (step + 0.5);
          // Floored at zero: a [Positioned] with a negative width asserts out
          // of layout, and a column narrower than a node plus its clearances
          // is not worth taking the whole card down for.
          final railWidth =
              math.max(0.0, column - _nodeSize - _railInset * 2);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: _nodeSize,
                child: Stack(
                  children: [
                    // Rails first, so a disc always paints over the line that
                    // runs into it.
                    for (var i = 0; i < _stepCount - 1; i++)
                      Positioned(
                        left: centreOf(i) + _nodeSize / 2 + _railInset,
                        width: railWidth,
                        top: (_nodeSize - _railHeight) / 2,
                        height: _railHeight,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 260),
                          curve: Curves.easeOut,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(2),
                            // Filled once the node to its LEFT is behind the
                            // resident, so the rail fills up to where they
                            // are rather than waiting on the step ahead.
                            //
                            // No glow on a 2.5px connector line. A completed
                            // segment is already the done colour against a
                            // grey one; a bloom around a hairline just blurs
                            // the hairline.
                            color: _completed > i
                                ? AppColors.ctaGreen
                                : AppColors.borderNeutralStrong,
                          ),
                        ),
                      ),
                    for (var i = 0; i < _stepCount; i++)
                      Positioned(
                        left: centreOf(i) - _nodeSize / 2,
                        top: 0,
                        child: _stepNode(i),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: _labelGap),
              Row(
                children: List.generate(_stepCount, (i) {
                  final isDone = i < _completed;
                  final isActive = i == _live;
                  // Centred, every one of them. Aligning the first label left
                  // and the last right is what a label row needs when its
                  // cells do NOT match the node positions — and is exactly
                  // what throws it off once they do.
                  return Expanded(
                    child: Text(
                      _labels[i],
                      textAlign: TextAlign.center,
                      style: sfPro(
                        fontSize: 9.5,
                        fontWeight:
                            isActive ? FontWeight.w700 : FontWeight.w500,
                        letterSpacing: 0.2,
                        color: isDone || isActive
                            ? AppColors.textPrimary
                            : AppColors.textMuted,
                      ),
                    ),
                  );
                }),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// ─────────────────────── CHOICE CHIP ROW ───────────────────────
/// A horizontally-wrapping row of selectable chips (category / filter).
class ChoiceChipRow extends StatelessWidget {
  final List<({String label, IconData icon})> options;
  final String selected;
  final ValueChanged<String> onSelected;

  const ChoiceChipRow({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: options.map((opt) {
        final isSelected = opt.label == selected;
        return GestureDetector(
          onTap: () => onSelected(opt.label),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: 10,
            ),
            decoration: BoxDecoration(
              color: isSelected
                  ? AppColors.primary.withValues(alpha: 0.12)
                  : AppColors.surface,
              // Selected chips get an asymmetric "soft geometric enclosure"
              // instead of the plain uniform pill everyone else uses.
              borderRadius: isSelected
                  ? const BorderRadius.only(
                      topLeft: Radius.circular(AppRadius.pill),
                      bottomRight: Radius.circular(AppRadius.pill),
                      topRight: Radius.circular(AppRadius.xs),
                      bottomLeft: Radius.circular(AppRadius.xs),
                    )
                  : BorderRadius.circular(AppRadius.pill),
              border: Border.all(
                color: isSelected
                    ? AppColors.primary
                    : AppColors.innerStroke,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  opt.icon,
                  size: 14,
                  color: isSelected ? AppColors.primary : AppColors.textSecondary,
                ),
                const SizedBox(width: 6),
                Text(
                  opt.label,
                  style: sfPro(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: isSelected ? AppColors.primary : AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}

/// ─────────────────────── INCIDENT STATUS TIMELINE ───────────────────────
/// Vertical 4-node timeline showing the full lifecycle of an incident report.
/// Past nodes glow Emerald Green, the active node pulses, pending nodes are
/// desaturated slate. Used inside the incident detail bottom sheet.
class IncidentStatusTimeline extends StatefulWidget {
  final Incident incident;

  const IncidentStatusTimeline({super.key, required this.incident});

  @override
  State<IncidentStatusTimeline> createState() => _IncidentStatusTimelineState();
}

class _IncidentStatusTimelineState extends State<IncidentStatusTimeline>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseCtrl;
  late Animation<double> _pulseAnim;

  // ── THE GRID ─────────────────────────────────────────────────────────────
  //
  // Four numbers set the whole vertical rhythm, and every gap in the stage
  // body is a multiple of four. They are named because the rail and the prose
  // beside it have to agree about where a stage starts and ends, and a
  // literal buried in one of the two columns is how they stopped agreeing
  // last time.

  /// Width of the rail column. Sized to the active node's halo, so a stage
  /// going live does not shove the text column sideways.
  static const double _railColumn = 28;

  /// Height of the box the dot is centred in — and, on the other side of the
  /// gutter, the box the stage label is centred in. One number for both is
  /// what puts a dot and its label on a shared centre line.
  static const double _dotSlot = 22;

  static const double _dotSize = 18;
  static const double _haloSize = 28;
  static const double _dotIconSize = 10;

  /// Gap between the rail column and the text column.
  static const double _gutter = 14;

  /// Vertical gap between one stage's content and the next stage's label.
  static const double _stageGap = 24;

  static const double _lineWidth = 2;

  /// Clearance between the connector and the dots at either end of it.
  static const double _lineInset = 6;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat(reverse: true);
    _pulseAnim = Tween<double>(begin: 0.55, end: 1.0).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  static const _nodes = [
    _TimelineNode(
      label: 'Report Submitted',
      sublabel: 'Ticket initialized and queued',
      icon: PhosphorIconsFill.uploadSimple,
    ),
    _TimelineNode(
      label: 'Verified by Security',
      sublabel: 'Guard has acknowledged the report',
      icon: PhosphorIconsFill.shieldCheck,
    ),
    _TimelineNode(
      label: 'Dispatched / In Progress',
      sublabel: 'Responding personnel are active',
      icon: PhosphorIconsFill.personSimpleRun,
    ),
    _TimelineNode(
      label: 'Resolved',
      sublabel: 'Incident has been closed',
      icon: PhosphorIconsFill.checkCircle,
    ),
  ];

  /// Server-verified timestamp for a timeline node, or null when the backend
  /// has no real time for that stage. Deliberately returns null rather than
  /// deriving a plausible-looking value — this chip previously rendered
  /// `reportedAt + (nodeIndex * 2 hours)`, which showed residents dispatch
  /// times that never happened.
  DateTime? _timestampForNode(int index) {
    switch (index) {
      case 0:
        return widget.incident.reportedAt;
      case 2:
        return widget.incident.dispatchedAt;
      case 3:
        return widget.incident.resolvedAt;
      default:
        // "Verified by Security" has no dedicated timestamp in the schema.
        return null;
    }
  }

  /// Prefers the real responder's name (written by the web command centers)
  /// over the node's generic placeholder copy.
  String _sublabelForNode(int index, _TimelineNode node, bool isPending, bool isActive) {
    if (isPending) return 'Pending';
    final guard = widget.incident.assignedGuardName;
    if (index == 2 && guard.isNotEmpty) {
      return isActive ? 'Responding: $guard' : 'Responded by $guard';
    }
    return isActive ? 'In progress…' : node.sublabel;
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.incident.status;
    // Same distinction the horizontal tracker draws, for the same reason: a
    // report that has stopped moving has no live node. Without this the last
    // node stayed "active" forever — pulsing, and captioned "Now" — on an
    // incident that closed weeks ago, which is the one node a resident opens
    // this sheet to check. See [IncidentLifecycle] for why `falseAlarm` stops
    // without completing.
    final activeStep = status.trackingStep;
    final completed = status.isComplete ? _nodes.length : activeStep;
    final textPrimary = AppColors.onGlassPrimary;
    final textSecondary = AppColors.onGlassSecondary;
    final doneColor = AppColors.success;
    // Slate, not white-at-22%. That value was legible only against the dark
    // glass sheet this timeline used to sit on; on the white panel it now
    // renders into, a pending node was drawn in white on white and simply did
    // not exist. Same for the resolution note fill below.
    final pendingColor = AppColors.borderNeutralStrong;
    final lineColorDone = AppColors.success.withValues(alpha: 0.70);
    final lineColorPending = AppColors.borderNeutral;

    // ── ONE ROW PER STAGE, AND THE LINE IS WHAT IS LEFT OVER ─────────────────
    //
    // The rail column and the text column used to be laid out independently:
    // the connector was `height: 56`, hard-coded, while the text beside it was
    // whatever its content came to plus 28px of bottom padding. Those two
    // numbers only agree for one particular combination of label, sublabel and
    // timestamp chip, and no stage has that combination reliably — the resolved
    // stage carries a wrapped resolution note, a pending stage carries one
    // word. So the line under-ran the next dot on a tall stage and over-ran it
    // on a short one, and the gap moved as the report progressed.
    //
    // [IntrinsicHeight] makes the row as tall as its tallest child, and the
    // connector then takes an [Expanded] share of the rail column: whatever is
    // left after the dot. The line therefore runs dot-to-dot by construction at
    // every content height, which is what "grid-aligned" has to mean for a rail
    // whose spacing is set by prose it does not control.
    //
    // IntrinsicHeight is a two-pass layout and normally worth avoiding. Four
    // rows in a bottom sheet is not where that cost shows up, and the
    // alternative is a magic number that is wrong for three stages out of four.
    return Column(
      children: List.generate(_nodes.length, (i) {
        final node = _nodes[i];
        final isDone = i < completed;
        final isActive = !status.isTerminal && i == activeStep;
        final isPending = !isDone && !isActive;
        final isLast = i == _nodes.length - 1;
        final timestamp = _timestampForNode(i);
        final showChip = isActive || (isDone && timestamp != null);
        final showResolution =
            isLast && widget.incident.status == IncidentStatus.resolved;

        final dotColor = isDone || isActive ? doneColor : pendingColor;

        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Left column: dot, then the line that fills the rest ───────
              SizedBox(
                width: _railColumn,
                child: Column(
                  children: [
                    SizedBox(
                      height: _dotSlot,
                      child: Center(
                        child: AnimatedBuilder(
                          animation: _pulseAnim,
                          builder: (_, __) => Stack(
                            alignment: Alignment.center,
                            children: [
                              if (isActive)
                                Container(
                                  width: _haloSize,
                                  height: _haloSize,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: doneColor.withValues(
                                        alpha: 0.22 * _pulseAnim.value),
                                  ),
                                ),
                              Container(
                                width: _dotSize,
                                height: _dotSize,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: dotColor,
                                  // Neutral. The PULSE is not lost with the
                                  // glow — it lives in the expanding halo
                                  // directly above, which is a fill, not a
                                  // shadow. This shadow was pulsing in the same
                                  // colour on top of that, doubling the
                                  // animation in the brand hue.
                                  boxShadow: (isDone || isActive)
                                      ? AppShadows.sm
                                      : null,
                                ),
                                child: Icon(
                                  isPending
                                      ? PhosphorIconsFill.circle
                                      : node.icon,
                                  size: _dotIconSize,
                                  color: isPending
                                      ? AppColors.onGlassMuted
                                      : Colors.white,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (!isLast)
                      Expanded(
                        child: Center(
                          child: Container(
                            width: _lineWidth,
                            margin: const EdgeInsets.symmetric(
                                vertical: _lineInset),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(_lineWidth),
                              color: isDone ? lineColorDone : lineColorPending,
                              gradient: isDone
                                  ? LinearGradient(
                                      begin: Alignment.topCenter,
                                      end: Alignment.bottomCenter,
                                      colors: [
                                        doneColor.withValues(alpha: 0.80),
                                        isActive
                                            ? doneColor.withValues(alpha: 0.20)
                                            : doneColor.withValues(alpha: 0.55),
                                      ],
                                    )
                                  : null,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),

              const SizedBox(width: _gutter),

              // ── Right column: label, sublabel, timestamp ──────────────────
              //
              // Every gap in here is a multiple of four, and the label sits in
              // a box of exactly [_dotSlot] — the same box the dot is centred
              // in — so the first line of type and the dot beside it share a
              // centre line rather than approximately agreeing. The stray 1px
              // SizedBox that used to nudge the label down is gone with it.
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(bottom: isLast ? 0 : _stageGap),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        height: _dotSlot,
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            node.label,
                            style: sfPro(
                              fontSize: 14,
                              height: 1.2,
                              fontWeight: isActive || isDone
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              color: isPending ? textSecondary : textPrimary,
                            ),
                          ),
                        ),
                      ),
                      Text(
                        _sublabelForNode(i, node, isPending, isActive),
                        style: sfPro(
                          fontSize: 12,
                          height: 1.35,
                          color: isActive
                              ? doneColor
                              : (isPending
                                  ? AppColors.onGlassMuted
                                  : textSecondary),
                          fontWeight:
                              isActive ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
                      // Only rendered when there's a real server timestamp to
                      // show (or the stage is live) — a completed stage with no
                      // recorded time simply shows no chip rather than a
                      // made-up one.
                      if (showChip) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: doneColor.withValues(alpha: 0.10),
                            borderRadius: BorderRadius.circular(AppRadius.pill),
                          ),
                          child: Text(
                            isActive
                                ? 'Now'
                                : DateFormat('MMM d • h:mm a')
                                    .format(timestamp!),
                            style: sfPro(
                              fontSize: 10.5,
                              height: 1.2,
                              fontWeight: FontWeight.w600,
                              color: doneColor,
                            ),
                          ),
                        ),
                      ],
                      if (showResolution) ...[
                        const SizedBox(height: 12),
                        // Fill only — the 35%-alpha emerald outline this had
                        // was a box drawn around a note that the tint already
                        // separates from the page.
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.success.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(AppRadius.lg),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(PhosphorIconsFill.notepad,
                                  size: 14, color: doneColor),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Resolution notes: Issue has been fully '
                                  'addressed by the HOA security team.',
                                  style: sfPro(
                                    fontSize: 12,
                                    color: textSecondary,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      }),
    );
  }
}

class _TimelineNode {
  final String label;
  final String sublabel;
  final IconData icon;
  const _TimelineNode({
    required this.label,
    required this.sublabel,
    required this.icon,
  });
}

/// ─────────────────────── REPORT DELETION ───────────────────────
///
/// Split into three pieces rather than the one `confirmDeleteReport` that used
/// to do all of it, because the swipe gesture needs them at different moments:
/// [Dismissible] asks for a yes/no BEFORE it animates the row away
/// (`confirmDismiss`) and only reports the deletion AFTER (`onDismissed`), so
/// the question and the write cannot stay welded together.
///
///   [confirmReportDeletion]  asks, answers bool, touches nothing
///   [deleteReport]           writes, reports success, asks nothing
///   [confirmDeleteReport]    both, for the long-press path
///
/// The permission check sits in front of all three — see [IncidentLifecycle].

/// Base dialog shell, so the delete prompt and the locked notice cannot drift
/// apart in radius, fill or typography.
Future<T?> _showReportDialog<T>(
  BuildContext context, {
  required String title,
  required Widget content,
  required List<Widget> Function(BuildContext ctx) actions,
}) {
  return showDialog<T>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: AppColors.backgroundSecondary,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.xl),
        side: const BorderSide(color: AppColors.innerStroke),
      ),
      title: Text(
        title,
        style: sfPro(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary),
      ),
      content: content,
      actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      actions: actions(ctx),
    ),
  );
}

TextStyle get _dialogBody =>
    sfPro(fontSize: 13.5, color: AppColors.textSecondary, height: 1.45);

/// Asks whether to delete [incident]. Returns false on dismiss or Cancel.
///
/// Answers a bool and does NOT write, so [Dismissible.confirmDismiss] can drive
/// the row's spring-back off the same prompt the long-press menu uses.
Future<bool> confirmReportDeletion(
    BuildContext context, Incident incident) async {
  final confirmed = await _showReportDialog<bool>(
    context,
    title: 'Delete report?',
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Are you sure you want to delete this resolved report from your '
          'history?',
          style: _dialogBody,
        ),
        const SizedBox(height: 10),
        // The consequence, kept separate from the question. A resident
        // answering "delete this from my history?" is picturing a list row,
        // not the photos they attached — and those go too.
        Text(
          'This permanently removes "${incident.title}" and its photo and '
          'video evidence. It can\'t be undone.',
          style: _dialogBody.copyWith(
              fontSize: 12.5, color: AppColors.textMuted),
        ),
      ],
    ),
    actions: (ctx) => [
      TextButton(
        onPressed: () => Navigator.of(ctx).pop(false),
        child: Text('Cancel',
            style: sfPro(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary)),
      ),
      ElevatedButton(
        onPressed: () => Navigator.of(ctx).pop(true),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.danger,
          foregroundColor: Colors.white,
          elevation: 0,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
        child: Text('Delete',
            style: sfPro(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Colors.white)),
      ),
    ],
  );
  return confirmed ?? false;
}

/// Explains why an open report has no delete action.
///
/// Reached from the long-press path; the swipe path says the same thing by
/// simply not moving — an open card does not budge, which is the cheapest
/// possible "no" and needs no dialog at all.
Future<void> showReportLockedNotice(
    BuildContext context, Incident incident) {
  return _showReportDialog<void>(
    context,
    title: 'Report still open',
    content: Text(
      '"${incident.title}" is still being handled by the HOA. Reports can be '
      'deleted once they are resolved — until then this record stays so the '
      'response has something to track against.',
      style: _dialogBody,
    ),
    actions: (ctx) => [
      TextButton(
        onPressed: () => Navigator.of(ctx).pop(),
        child: Text('Got it',
            style: sfPro(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.primary)),
      ),
    ],
  );
}

/// Performs the delete and reports whether it landed.
///
/// The bool is load-bearing for the swipe path: [Dismissible] has already
/// animated the row out of the list by the time this runs, so a caller holding
/// an optimistic removal needs to know to put it back.
Future<bool> deleteReport(BuildContext context, Incident incident) async {
  final messenger = ScaffoldMessenger.of(context);
  try {
    await LocalDataStore.instance.deleteIncident(incident);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.backgroundElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: AppColors.innerStroke),
      ),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
      content: Text('Report deleted',
          style: sfPro(
              color: AppColors.textPrimary, fontWeight: FontWeight.w500)),
    ));
    return true;
  } catch (_) {
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.danger,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
      content: Text('Could not delete the report. Please try again.',
          style: sfPro(color: Colors.white, fontWeight: FontWeight.w500)),
    ));
    return false;
  }
}

/// Long-press path: permission check, then confirm, then delete.
Future<void> confirmDeleteReport(
    BuildContext context, Incident incident) async {
  if (!incident.status.isDeletable) {
    return showReportLockedNotice(context, incident);
  }
  if (!await confirmReportDeletion(context, incident)) return;
  if (!context.mounted) return;
  await deleteReport(context, incident);
}

void showIncidentTimeline(BuildContext context, Incident incident) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (_) => _IncidentTimelineSheet(incident: incident),
  );
}

class _IncidentTimelineSheet extends StatelessWidget {
  final Incident incident;

  const _IncidentTimelineSheet({required this.incident});

  @override
  Widget build(BuildContext context) {
    final textPrimary = AppColors.onGlassPrimary;
    final textSecondary = AppColors.onGlassSecondary;
    final sColor = IncidentStatusInfo.color(incident.status);
    final pColor = IncidentPriorityInfo.color(incident.priority);
    final sheetRadius = const BorderRadius.vertical(
      top: Radius.circular(AppRadius.xl),
    );

    return DraggableScrollableSheet(
      initialChildSize: 0.72,
      minChildSize: 0.40,
      maxChildSize: 0.92,
      builder: (_, controller) => ClipRRect(
        borderRadius: sheetRadius,
        // ── SOLID WHITE, NO BLUR ────────────────────────────────────────────
        //
        // This was the last glassmorphic surface left in the app: a 24px
        // BackdropFilter over emerald at 35%, with slate text sitting on
        // whatever colour happened to be behind it. Every other container moved
        // to white-on-white several passes ago; this one survived because it
        // only appears on tap. It IS the background shift — open a report from
        // the white History list and the panel that slides up was dark green.
        //
        // Dropping the BackdropFilter also drops a full-screen blur pass from a
        // sheet that animates its own height on every drag.
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: sheetRadius,
            border: Border.all(color: AppColors.borderNeutralSoft),
          ),
            child: Column(
              children: [
                // ── Drag handle ─────────────────────────────────────────
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Container(
                    width: 38,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.borderNeutralStrong,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                  ),
                ),

            // ── Header ──────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Both pills are fill-only now, at the same alpha as the
                  // status badge on the History card these open from — the
                  // outline was a second, darker copy of the shade already
                  // filling them, and the two surfaces disagreed about whether
                  // a status pill has an edge.
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 11, vertical: 5),
                        decoration: BoxDecoration(
                          color: sColor.withValues(alpha: 0.16),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentStatusInfo.label(incident.status),
                          style: sfPro(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: sColor,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 11, vertical: 5),
                        decoration: BoxDecoration(
                          color: pColor.withValues(alpha: 0.16),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentPriorityInfo.label(incident.priority),
                          style: sfPro(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: pColor,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    incident.title,
                    style: sfPro(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: textPrimary,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(PhosphorIconsFill.mapPin,
                          size: 13, color: textSecondary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          incident.location,
                          style: sfPro(
                              fontSize: 13, color: textSecondary),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            const Divider(
              height: 1,
              thickness: 1,
              color: AppColors.borderNeutralSoft,
            ),

            // ── Scrollable timeline body ─────────────────────────────
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
                children: [
                  Text(
                    'Status Timeline',
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onGlassMuted,
                      letterSpacing: 0.7,
                    ),
                  ),
                  const SizedBox(height: 20),
                  IncidentStatusTimeline(incident: incident),
                  if (incident.hasMedia ||
                      incident.photoUrls.isNotEmpty ||
                      incident.videoUrls.isNotEmpty) ...[
                    const SizedBox(height: 28),
                    EvidenceSection(incident: incident),
                  ],
                  const SizedBox(height: 28),
                  _ReportSummarySection(incident: incident),
                ],
              ),
            ),
          ],
              ),
            ),
        ),
    );
  }
}

/// "Report Summary" — the structured recap of a report's key fields, shown at
/// the bottom of the History detail sheet.
///
/// ── A TABLE, NOT A LIST OF DECORATED LINES ────────────────────────────────
/// This was five icon-and-stacked-text rows: a 15px glyph, then the field name
/// in small caps with the value under it, repeated. Two problems compound
/// there. Stacking label over value means every field is two lines tall and
/// nothing lines up vertically between fields, so the eye has no column to run
/// down — the reader parses five little cards instead of scanning one table.
/// And the icons were decorative: a tag beside "Category", a pin beside
/// "Location", a clock beside "Reported On" all restate the word next to them,
/// while costing 25px of the value's width on the narrowest screens.
///
/// It is now what it always was underneath — a metadata table. Field names sit
/// in a fixed left column, values start on one shared alignment line, and a
/// hairline separates each row. The description, which is prose rather than a
/// field, drops to a full-width block at the end where it can wrap without
/// dragging the value column out with it.
class _ReportSummarySection extends StatelessWidget {
  final Incident incident;
  const _ReportSummarySection({required this.incident});

  /// The label column. Wide enough for the longest field name at this weight
  /// ("Reported By") without wrapping, and fixed so every value in the card
  /// starts on the same vertical line.
  static const double _labelColumn = 104;

  static const double _sidePad = 16;
  static const double _rowPad = 13;

  @override
  Widget build(BuildContext context) {
    // Field names follow the spec's vocabulary rather than the model's:
    // `incident.category` is displayed as "Incident Type" and `reportedAt` as
    // "Date & Time". The data is untouched — this is the label a resident
    // reads, not a rename of anything the app stores.
    final fields = <(String, String)>[
      ('Incident Type', incident.category),
      ('Priority', IncidentPriorityInfo.label(incident.priority)),
      ('Status', IncidentStatusInfo.label(incident.status)),
      (
        'Date & Time',
        DateFormat('MMM d, yyyy · h:mm a').format(incident.reportedAt),
      ),
      ('Location', incident.location),
      ('Reported By', incident.reporter),
    ];

    return Container(
      // White fill, slate-100 hairline, `shadow-sm` — matched to the History
      // cards this sheet opens from. Both surfaces move together or the detail
      // view stops looking like the same app as the list that led to it.
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: AppColors.borderNeutralSoft,
          width: AppStroke.hairline,
        ),
        boxShadow: AppShadows.sm,
      ),
      // Clipped so the hairline rules below meet the rounded corner cleanly
      // instead of running out past it.
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(_sidePad, 14, _sidePad, 14),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Report Summary',
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onGlassMuted,
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                Text(
                  incident.id,
                  style: sfPro(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          for (final (label, value) in fields) ...[
            const _SummaryRule(),
            _summaryRow(label, value),
          ],
          if (incident.description.isNotEmpty) ...[
            const _SummaryRule(),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  _sidePad, _rowPad, _sidePad, _rowPad + 3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Description', style: _labelStyle),
                  const SizedBox(height: 6),
                  Text(
                    incident.description,
                    style: sfPro(
                      fontSize: 13,
                      height: 1.45,
                      color: AppColors.onGlassPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  static TextStyle get _labelStyle => sfPro(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: AppColors.onGlassMuted,
      );

  Widget _summaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(_sidePad, _rowPad, _sidePad, _rowPad),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: _labelColumn,
            child: Text(label, style: _labelStyle),
          ),
          Expanded(
            child: Text(
              value,
              style: sfPro(
                fontSize: 13,
                height: 1.35,
                fontWeight: FontWeight.w600,
                color: AppColors.onGlassPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The hairline between two summary rows. Full-bleed on purpose: an inset rule
/// inside a card that already has a border draws a second, shorter edge a few
/// pixels in from the first, and the two read as a misalignment.
class _SummaryRule extends StatelessWidget {
  const _SummaryRule();

  @override
  Widget build(BuildContext context) => const Divider(
        height: AppStroke.hairline,
        thickness: AppStroke.hairline,
        color: AppColors.borderNeutralSoft,
      );
}
