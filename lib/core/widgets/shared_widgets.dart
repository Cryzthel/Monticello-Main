import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';
import 'glass_container.dart';

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
    final scheme = Theme.of(context).colorScheme;
    final secondary = Theme.of(context).brightness == Brightness.dark
        ? AppColors.textSecondaryOnDark
        : AppColors.textSecondary;
    final onSurface = scheme.onSurface;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (showBack) ...[
                GlassContainer(
                  width: 40,
                  height: 40,
                  borderRadius: AppRadius.sm,
                  padding: EdgeInsets.zero,
                  variant: GlassVariant.subtle,
                  onTap: () => Navigator.of(context).maybePop(),
                  child: Icon(
                    Icons.arrow_back_ios_new,
                    size: 14,
                    color: onSurface,
                  ),
                ),
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
    final accent = Theme.of(context).brightness == Brightness.dark
        ? AppColors.ctaGreen
        : AppColors.accent;
    final titleColor = Theme.of(context).colorScheme.onSurface;

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
                  Text(action!, style: GoogleFonts.inter(fontSize: 12.5, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 2),
                  const Icon(Icons.chevron_right, size: 14),
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
    final green = AppColors.ctaGreen;
    const foreground = Colors.white;
    final btn = ElevatedButton(
      onPressed: loading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: color ?? green,
        disabledBackgroundColor: (color ?? green).withOpacity(0.45),
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
            (_) => foreground.withOpacity(0.10),
          ),
        ),
      ),
      child: loading
          ? const SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2.2,
                color: Colors.white,
              ),
            )
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
    final tinted = color ?? green;
    final wrappedGlow = glowing
        ? DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.md),
              boxShadow: [
                BoxShadow(
                  color: tinted.withOpacity(0.42),
                  blurRadius: 22,
                  spreadRadius: -2,
                  offset: const Offset(0, 10),
                ),
                BoxShadow(
                  color: tinted.withOpacity(0.20),
                  blurRadius: 36,
                  spreadRadius: -4,
                  offset: const Offset(0, 6),
                ),
              ],
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final fg = Theme.of(context).colorScheme.onSurface;
    final edge = isDark ? AppColors.innerStroke : const Color(0xFFE2E5EB);

    final btn = OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: fg,
        side: BorderSide(color: edge),
        backgroundColor:
            isDark ? AppColors.midnightSurface.withOpacity(0.35) : Colors.white.withOpacity(0.82),
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
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: color.withOpacity(0.28)),
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
            style: GoogleFonts.inter(
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
        color: solid ? color.withOpacity(0.2) : Colors.white.withOpacity(0.06),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: color.withOpacity(solid ? 0.45 : 0.22)),
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
            style: GoogleFonts.inter(
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
              color: accent.withOpacity(0.18),
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
                  color: accent.withOpacity(0.18),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 16, color: accent),
              ),
              const Spacer(),
              if (trend != null)
                Text(
                  trend!,
                  style: GoogleFonts.inter(
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
              color: iconColor.withOpacity(0.18),
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
            const Icon(Icons.chevron_right, color: AppColors.textMuted, size: 20),
        ],
      ),
    );
  }
}

/// ─────────────────────── SEGMENTED CONTROL ───────────────────────
/// Glass pill-style segmented switch — used for top-of-screen filters.
class SegmentedControl extends StatelessWidget {
  final List<String> segments;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  const SegmentedControl({
    super.key,
    required this.segments,
    required this.selectedIndex,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      padding: const EdgeInsets.all(4),
      borderRadius: AppRadius.pill,
      variant: GlassVariant.subtle,
      child: Row(
        children: List.generate(segments.length, (i) {
          final selected = i == selectedIndex;
          return Expanded(
            child: GestureDetector(
              onTap: () => onChanged(i),
              behavior: HitTestBehavior.opaque,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOut,
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: selected
                      ? AppColors.accent.withOpacity(0.22)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  border: selected
                      ? Border.all(color: AppColors.accent.withOpacity(0.5))
                      : null,
                ),
                child: Center(
                  child: Text(
                    segments[i],
                    style: GoogleFonts.inter(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: selected ? AppColors.accent : AppColors.textSecondary,
                    ),
                  ),
                ),
              ),
            ),
          );
        }),
      ),
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
    final secondary = Theme.of(context).brightness == Brightness.dark
        ? AppColors.textSecondaryOnDark
        : AppColors.textSecondary;
    final muted = Theme.of(context).brightness == Brightness.dark
        ? AppColors.textSecondaryOnDark
        : AppColors.textMuted;
    final fg = Theme.of(context).colorScheme.onSurface;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
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
          keyboardType: keyboardType,
          maxLines: obscureText ? 1 : maxLines,
          validator: validator,
          style: GoogleFonts.inter(color: fg, fontSize: 14.5),
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
/// Compact shipping-style timeline for incident progress.
class ReportStatusTracker extends StatelessWidget {
  final IncidentStatus status;
  final double verticalPadding;

  const ReportStatusTracker({
    super.key,
    required this.status,
    this.verticalPadding = 4,
  });

  static const _labels = ['Submitted', 'Verified', 'In progress', 'Resolved'];

  @override
  Widget build(BuildContext context) {
    final step = status.trackingStep;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final dimLine = isDark
        ? AppColors.innerStroke.withValues(alpha: 0.95)
        : const Color(0xFFE5E9F0);

    final activeDot = AppColors.ctaGreen;
    final idleDot = isDark ? AppColors.midnightInputFill : const Color(0xFFEEF1F7);
    final glow = activeDot.withValues(alpha: 0.42);

    return Padding(
      padding: EdgeInsets.symmetric(vertical: verticalPadding),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              for (var i = 0; i < 4; i++) ...[
                _TrackerDot(
                  filled: i <= step,
                  activeColor: activeDot,
                  idleColor: idleDot,
                  glowColor: glow,
                ),
                if (i < 3)
                  Expanded(
                    child: _TrackerSegment(
                      active: step > i,
                      activeColor: activeDot,
                      dimColor: dimLine,
                      glowColor: glow,
                    ),
                  ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: List.generate(4, (i) {
              final align = i == 0
                  ? TextAlign.left
                  : (i == 3 ? TextAlign.right : TextAlign.center);
              final highlight = i == step;
              final done = i <= step;
              return Expanded(
                child: Text(
                  _labels[i],
                  textAlign: align,
                  style: GoogleFonts.inter(
                    fontSize: 9.5,
                    fontWeight: highlight ? FontWeight.w700 : FontWeight.w500,
                    letterSpacing: 0.2,
                    color: done
                        ? Theme.of(context).colorScheme.onSurface
                        : (isDark
                            ? AppColors.textSecondaryOnDark
                            : AppColors.textMuted),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

class _TrackerDot extends StatelessWidget {
  final bool filled;
  final Color activeColor;
  final Color idleColor;
  final Color glowColor;

  const _TrackerDot({
    required this.filled,
    required this.activeColor,
    required this.idleColor,
    required this.glowColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 11,
      height: 11,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? activeColor : idleColor,
        boxShadow: filled
            ? [
                BoxShadow(
                  color: glowColor,
                  blurRadius: 10,
                  spreadRadius: 0.5,
                ),
                BoxShadow(
                  color: activeColor.withValues(alpha: 0.35),
                  blurRadius: 16,
                ),
              ]
            : null,
      ),
    );
  }
}

class _TrackerSegment extends StatelessWidget {
  final bool active;
  final Color activeColor;
  final Color dimColor;
  final Color glowColor;

  const _TrackerSegment({
    required this.active,
    required this.activeColor,
    required this.dimColor,
    required this.glowColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 2,
      margin: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(99),
        color: active ? null : dimColor,
        gradient: active
            ? LinearGradient(
                colors: [
                  activeColor.withValues(alpha: 0.95),
                  activeColor.withValues(alpha: 0.45),
                ],
              )
            : null,
        boxShadow: active
            ? [
                BoxShadow(
                  color: glowColor,
                  blurRadius: 8,
                  spreadRadius: -1,
                ),
              ]
            : null,
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
                  ? AppColors.accent.withOpacity(0.22)
                  : Colors.white.withOpacity(0.06),
              borderRadius: BorderRadius.circular(AppRadius.pill),
              border: Border.all(
                color: isSelected
                    ? AppColors.accent
                    : Colors.white.withOpacity(0.14),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  opt.icon,
                  size: 14,
                  color: isSelected ? AppColors.accent : AppColors.textSecondary,
                ),
                const SizedBox(width: 6),
                Text(
                  opt.label,
                  style: GoogleFonts.inter(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: isSelected ? AppColors.accent : AppColors.textPrimary,
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
      icon: Icons.upload_rounded,
    ),
    _TimelineNode(
      label: 'Verified by Security',
      sublabel: 'Guard has acknowledged the report',
      icon: Icons.verified_user_rounded,
    ),
    _TimelineNode(
      label: 'Dispatched / In Progress',
      sublabel: 'Responding personnel are active',
      icon: Icons.directions_run_rounded,
    ),
    _TimelineNode(
      label: 'Resolved',
      sublabel: 'Incident has been closed',
      icon: Icons.check_circle_rounded,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final activeStep = widget.incident.status.trackingStep;
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
    final doneColor = AppColors.ctaGreen;
    final pendingColor =
        isDark ? const Color(0xFF2D3548) : const Color(0xFFE9ECEF);
    final lineColorDone = AppColors.ctaGreen.withOpacity(0.70);
    final lineColorPending =
        isDark ? const Color(0xFF252D3F) : const Color(0xFFE2E5EB);

    return Column(
      children: List.generate(_nodes.length, (i) {
        final node = _nodes[i];
        final isDone = i < activeStep;
        final isActive = i == activeStep;
        final isPending = i > activeStep;
        final isLast = i == _nodes.length - 1;

        final dotColor = isDone || isActive ? doneColor : pendingColor;

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Left column: dot + line ──────────────────────────────
            SizedBox(
              width: 36,
              child: Column(
                children: [
                  // Dot
                  AnimatedBuilder(
                    animation: _pulseAnim,
                    builder: (_, __) {
                      return Stack(
                        alignment: Alignment.center,
                        children: [
                          if (isActive)
                            Container(
                              width: 28,
                              height: 28,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: doneColor
                                    .withOpacity(0.22 * _pulseAnim.value),
                              ),
                            ),
                          Container(
                            width: 18,
                            height: 18,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: dotColor,
                              boxShadow: (isDone || isActive)
                                  ? [
                                      BoxShadow(
                                        color: doneColor.withOpacity(
                                            isActive
                                                ? 0.55 * _pulseAnim.value
                                                : 0.30),
                                        blurRadius: 12,
                                        spreadRadius: 1,
                                      ),
                                    ]
                                  : null,
                            ),
                            child: Icon(
                              isPending
                                  ? Icons.circle_outlined
                                  : node.icon,
                              size: 10,
                              color: isPending
                                  ? (isDark
                                      ? AppColors.textSecondaryOnDark
                                      : AppColors.textMuted)
                                  : Colors.white,
                            ),
                          ),
                        ],
                      );
                    },
                  ),

                  // Connector line
                  if (!isLast)
                    Container(
                      width: 2,
                      height: 56,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(2),
                        color: isDone ? lineColorDone : lineColorPending,
                        gradient: isDone
                            ? LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [
                                  doneColor.withOpacity(0.80),
                                  isActive
                                      ? doneColor.withOpacity(0.20)
                                      : doneColor.withOpacity(0.55),
                                ],
                              )
                            : null,
                      ),
                    ),
                ],
              ),
            ),

            const SizedBox(width: 14),

            // ── Right column: label + timestamp ──────────────────────
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 1),
                    Text(
                      node.label,
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: isActive || isDone
                            ? FontWeight.w700
                            : FontWeight.w500,
                        color: isPending ? textSecondary : textPrimary,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      isPending
                          ? 'Pending'
                          : (isActive ? 'In progress…' : node.sublabel),
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: isActive
                            ? doneColor
                            : (isPending
                                ? (isDark
                                    ? AppColors.textSecondaryOnDark
                                        .withOpacity(0.55)
                                    : AppColors.textMuted)
                                : textSecondary),
                        fontWeight: isActive
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                    if (isDone || isActive) ...[
                      const SizedBox(height: 5),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: doneColor.withOpacity(0.10),
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          isDone
                              ? DateFormat('MMM d • h:mm a')
                                  .format(widget.incident.reportedAt
                                      .add(Duration(hours: i * 2)))
                              : 'Now',
                          style: GoogleFonts.inter(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w600,
                            color: doneColor,
                          ),
                        ),
                      ),
                    ],
                    if (i == _nodes.length - 1 &&
                        widget.incident.status == IncidentStatus.resolved)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isDark
                                ? AppColors.midnightSurfaceElevated
                                : const Color(0xFFF0FDF4),
                            borderRadius:
                                BorderRadius.circular(AppRadius.md),
                            border: Border.all(
                                color: doneColor.withOpacity(0.25)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.notes_rounded,
                                  size: 14, color: AppColors.ctaGreen),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Resolution notes: Issue has been fully addressed by the HOA security team.',
                                  style: GoogleFonts.inter(
                                    fontSize: 12,
                                    color: textSecondary,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
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

/// Shows the incident detail timeline in a premium bottom sheet.
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
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.midnightSurface : Colors.white;
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
    final sColor = IncidentStatusInfo.color(incident.status);
    final pColor = IncidentPriorityInfo.color(incident.priority);

    return DraggableScrollableSheet(
      initialChildSize: 0.72,
      minChildSize: 0.40,
      maxChildSize: 0.92,
      builder: (_, controller) => Container(
        decoration: BoxDecoration(
          color: bg,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(AppRadius.xl),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(isDark ? 0.55 : 0.15),
              blurRadius: 40,
              offset: const Offset(0, -8),
            ),
          ],
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
                  color: isDark
                      ? AppColors.innerStroke
                      : const Color(0xFFDDE1E9),
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
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: sColor.withOpacity(0.12),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                          border: Border.all(
                              color: sColor.withOpacity(0.30)),
                        ),
                        child: Text(
                          IncidentStatusInfo.label(incident.status),
                          style: GoogleFonts.inter(
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
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: pColor.withOpacity(0.10),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentPriorityInfo.label(incident.priority),
                          style: GoogleFonts.inter(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: pColor,
                          ),
                        ),
                      ),
                      const Spacer(),
                      Text(
                        incident.id,
                        style: GoogleFonts.inter(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    incident.title,
                    style: GoogleFonts.inter(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: textPrimary,
                      letterSpacing: -0.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.location_on_outlined,
                          size: 13, color: textSecondary),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          incident.location,
                          style: GoogleFonts.inter(
                              fontSize: 13, color: textSecondary),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            Divider(
              height: 1,
              thickness: 1,
              color: isDark
                  ? AppColors.innerStroke
                  : const Color(0xFFF0F1F4),
            ),

            // ── Scrollable timeline body ─────────────────────────────
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
                children: [
                  Text(
                    'Status Timeline',
                    style: GoogleFonts.inter(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textMuted,
                      letterSpacing: 0.7,
                    ),
                  ),
                  const SizedBox(height: 20),
                  IncidentStatusTimeline(incident: incident),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
