import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// A text link with a trailing chevron — "Read more", "See all", "View all".
///
/// ── WHAT IT REPLACED ──────────────────────────────────────────────────────
/// Two hand-rolled copies that had already drifted, in components that appear
/// on the SAME SCREEN — the announcements panel's "See all" sits directly above
/// the cards carrying "Read more":
///
///   panel:  12.5pt text · 2px gap · 13px `PhosphorIconsFill.caretRight`
///   card:   12.0pt text · 2px gap · 14px `PhosphorIconsFill.caretRight`
///
/// Half a point of type and a pixel of glyph is not something anyone notices
/// as a defect; it is something they feel as the screen being slightly untidy.
///
/// Both also drew the FILL caret, which in Phosphor is a solid triangle rather
/// than a chevron — a row of little play buttons down the feed. [AppIcons]
/// explains that trap in full.
class InlineActionLink extends StatelessWidget {
  const InlineActionLink({
    super.key,
    required this.label,
    this.onTap,
    this.color = AppColors.accentPrimary,
    this.fontSize = 12.5,
  });

  final String label;

  /// Null renders the link as pure decoration — for a row whose whole surface
  /// is already tappable, where a second gesture detector inside it would only
  /// create a dead zone the parent's ripple does not reach.
  final VoidCallback? onTap;

  /// `text-emerald-600` by default; pass a slate for a secondary link.
  final Color color;

  final double fontSize;

  /// `w-4 h-4`. Fixed at 16 rather than scaled off [fontSize].
  ///
  /// A chevron that tracks the type size sounds tidier and is not: at 12pt it
  /// computes to ~13px, which is where the glyph's stroke starts breaking up on
  /// a 3x screen. 16 is the smallest size this shape stays crisp at, and the
  /// half-point of type variation between call sites is invisible next to it.
  static const double iconSize = 16;

  @override
  Widget build(BuildContext context) {
    final content = Row(
      mainAxisSize: MainAxisSize.min,
      // Centre, not baseline. A chevron has no baseline of its own — Flutter
      // would align its BOX bottom to the text baseline and hang it low.
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(
          label,
          style: sfPro(
            fontSize: fontSize,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
        const SizedBox(width: 2),
        Icon(AppIcons.chevronRight, size: iconSize, color: color),
      ],
    );

    if (onTap == null) return content;

    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap!();
        },
        behavior: HitTestBehavior.opaque,
        // Padding rather than a SizedBox: the label's width is unknown, so the
        // target has to grow around the text instead of being declared. 8/6
        // lifts a ~17px line box to roughly 33px — short of 44, which is
        // acceptable only because these links sit inside larger tappable rows
        // and are never the sole way to reach their destination.
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
          child: content,
        ),
      ),
    );
  }
}
