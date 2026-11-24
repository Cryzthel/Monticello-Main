// Shared UI primitives: headers, buttons, chips, cards, fields, segmented control, empty state.
// Split out of shared_widgets.dart (2026-10-20), which re-exports it.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:flutter/services.dart';
import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/glass_container.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';

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
