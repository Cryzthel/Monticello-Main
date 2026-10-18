import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The app's list-row primitives: a leading icon tile, a label, and either a
/// drill-in chevron or a switch.
///
/// ── ONE ACCENT, NOT NINE ──────────────────────────────────────────────────
/// This has been at both extremes. Rows once tinted each tile with the ROW'S
/// OWN colour at 16% — nine rows carrying nine different washes down one list,
/// decoration doing the work of hierarchy and getting it backwards, since a
/// settings list is a set of equal-weight destinations. The correction was to
/// paint every glyph slate-700 on slate-100, which fixed the inconsistency by
/// removing the colour altogether and left the app's most-visited list reading
/// as grey chrome while every other surface — notification tiles, incident
/// cards, empty states — leads with the brand.
///
/// The settled position is ONE accent, applied identically to every row: an
/// emerald glyph, standing on the row with no plate behind it (see
/// [SettingsIconTile]). Equal-weight rows
/// stay equal because they are all the same colour, and the list belongs to
/// the app it is part of.
///
/// Exactly one row still departs from it, and it is not a style choice — see
/// [SettingsRow.destructive]. Sign out in brand emerald would be a destructive
/// action wearing the colour the rest of the app uses for "yes, go ahead".
///
/// ── THE GRID ──────────────────────────────────────────────────────────────
/// `px-4 py-3`, a 40px tile, a 12px gap. Everything lands on the 8px step
/// except that gap (a 1.5 half-step), and the divider indent is DERIVED from
/// those numbers rather than typed — it was hand-set to 56 against a real
/// content offset of 58, so every separator in Settings was 2px short of the
/// text it was meant to align with.
class SettingsRow extends StatelessWidget {
  const SettingsRow({
    super.key,
    required this.icon,
    required this.label,
    this.onTap,
    this.trailing,
    this.showChevron = true,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  /// Replaces the chevron — a switch, a value, a badge.
  final Widget? trailing;

  final bool showChevron;

  /// Sign out, and nothing else so far. The label, glyph and tile wash go red
  /// together — the tile follows the glyph rather than staying neutral, because
  /// the neutral tile it used to keep no longer exists: every other row's tile
  /// is now an emerald wash, and leaving this one grey would make the
  /// destructive row the odd one out for the wrong reason.
  ///
  /// The red is danger at the same 12% the accent rows use, so this reads as
  /// "the same row in a different key" rather than as a warning banner.
  final bool destructive;

  // ── Metrics. Read by [SettingsRowDivider] so the two cannot disagree. ──
  static const double padX = 16; // px-4
  static const double padY = 12; // py-3
  /// The leading glyph's slot. 24, down from the 40px plate it used to sit
  /// on — see [SettingsIconTile] for why the plate went.
  static const double tileSize = 24;
  static const double tileRadius = 12; // the skeleton's placeholder only
  static const double iconSize = 22;
  static const double gap = 14;

  /// Where a divider must start to line up with the label above it.
  static const double contentInset = padX + tileSize + gap;

  @override
  Widget build(BuildContext context) {
    final labelColor =
        destructive ? AppColors.danger : AppColors.textPrimary;
    final glyphColor =
        destructive ? AppColors.danger : SettingsIconTile.accent;

    return Semantics(
      button: onTap != null,
      label: label,
      child: InkWell(
        onTap: onTap == null
            ? null
            : () {
                HapticFeedback.selectionClick();
                onTap!();
              },
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: padX, vertical: padY),
          child: Row(
            children: [
              SettingsIconTile(icon: icon, color: glyphColor),
              const SizedBox(width: gap),
              Expanded(
                child: Text(
                  label,
                  style: sfPro(
                    fontSize: 14.5,
                    // Bold, per the unified spec. A settings label is the row's
                    // primary content and was setting at w500 — one step
                    // lighter than the announcement and notification headlines
                    // it now sits alongside.
                    fontWeight: FontWeight.w600,
                    color: labelColor,
                  ),
                ),
              ),
              if (trailing != null)
                trailing!
              else if (showChevron)
                // 18px, down from 22. A chevron is the quietest thing in the
                // row — it says "there is more this way", not "look here" —
                // and at 22 it was larger than the label's own cap height.
                const Icon(AppIcons.chevronRight,
                    size: 18, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// The leading glyph of a settings row — a bare vector icon, NO plate.
///
/// ── THE GREEN SQUARES ARE GONE ────────────────────────────────────────────
/// Every row used to set its glyph on a 40px rounded square of its own colour
/// at 12%. Down a list of a dozen equal rows that was a column of green tiles
/// doing the work of decoration, and it pushed every label 54px in from the
/// edge. Now the icon stands on the row by itself, at full strength in the
/// accent, in a fixed slot so the labels still line up.
///
/// One [color] still decides the glyph, so the destructive row stays red and
/// cannot be built half-toned. (The name is kept from when it was a tile; the
/// shape changed, the call sites did not need to.)
class SettingsIconTile extends StatelessWidget {
  const SettingsIconTile({
    super.key,
    required this.icon,
    this.color = accent,
  });

  /// The settings palette, in one place. Every row that is not destructive
  /// draws this exact colour — see the class note on [SettingsRow].
  static const Color accent = AppColors.primary;

  /// The accent wash the profile avatar's empty state still uses. No row
  /// draws it any more.
  static const double washOpacity = 0.12;

  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: SettingsRow.tileSize,
      height: SettingsRow.tileSize,
      child: Center(
        child: Icon(icon, size: SettingsRow.iconSize, color: color),
      ),
    );
  }
}

/// A settings row whose trailing control is a switch.
///
/// Shares [SettingsRow]'s padding rather than declaring its own. The two used
/// to differ — `vertical: 14` for nav rows against `vertical: 8` for switch
/// rows — so a group mixing them had rows of two different heights, and the
/// icon tiles down the left edge sat at uneven intervals.
///
/// A [Switch] is ~40px tall against a ~20px label, so at equal padding a switch
/// row is naturally the taller of the two. That is fine and expected; what was
/// wrong was the padding differing on top of it.
class SettingsSwitchRow extends StatelessWidget {
  const SettingsSwitchRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      toggled: value,
      label: label,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: SettingsRow.padX,
          // Trimmed against the nav row's 12 because the Switch is already
          // ~40px tall on its own; matching 12 here would make toggle rows
          // visibly taller than their neighbours in the same group.
          vertical: 4,
        ),
        child: Row(
          children: [
            SettingsIconTile(icon: icon),
            const SizedBox(width: SettingsRow.gap),
            Expanded(
              child: Text(
                label,
                style: sfPro(
                  fontSize: 14.5,
                  // Matches SettingsRow's label exactly — a toggle row and a
                  // nav row are the same rank and must set identically.
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            Switch.adaptive(
              value: value,
              onChanged: (v) {
                HapticFeedback.selectionClick();
                onChanged(v);
              },
              activeThumbColor: AppColors.onAccent,
              activeTrackColor: AppColors.accentPrimary,
            ),
          ],
        ),
      ),
    );
  }
}

/// The hairline between two rows in a group, inset to the label.
class SettingsRowDivider extends StatelessWidget {
  const SettingsRowDivider({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      // DERIVED, not typed. See [SettingsRow.contentInset].
      padding: EdgeInsets.only(left: SettingsRow.contentInset),
      child: Divider(
        height: 1,
        thickness: 0.5,
        color: AppColors.borderNeutral,
      ),
    );
  }
}
