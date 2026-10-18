import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The floating control cluster every map in the app uses.
///
/// ONE definition, shared by the dashboard card, the incident picker and the
/// standalone map screen. They previously had three private copies that had
/// already drifted — different icons for the same action, one stacked and one
/// in a row, and a recentre button that existed on one map and not another.
///
/// ── TWO BUTTONS. THAT IS THE WHOLE CONTROL SET. ───────────────────────────
/// Layer toggle, and "where am I". Everything else that used to float over
/// these maps — zoom in, zoom out, compass, fit-the-village — is gone.
///
/// The case for cutting them: every one of those actions is already a gesture
/// the resident performs without thinking (pinch, two-finger twist,
/// double-tap), so the buttons were a second, slower way to do things fingers
/// already do — while permanently occupying the corner of a 240px card and
/// covering the map they were meant to help read. The two that remain are the
/// two that have NO gesture: you cannot pinch your way to a different basemap,
/// and you cannot swipe to your own GPS coordinate.
///
/// What that costs, stated plainly: on the standalone map screen those buttons
/// were also the pointer-accessible path to zoom and north-reset. Keyboard
/// control survives them (`+`/`-` zoom, `Q`/`E` rotate, `0` resets north — see
/// AccessibleMap's shortcut handler) and recentre now resets bearing, so no
/// action has become unreachable. A user who can neither pinch nor use a
/// keyboard has lost zoom, and if that turns out to describe real residents the
/// answer is to bring back a zoom pair here, not to scatter private copies.
class MapControlCluster extends StatelessWidget {
  const MapControlCluster({
    super.key,
    required this.children,
    this.axis = Axis.vertical,
  });

  final List<Widget> children;

  /// Vertical by default. Horizontal reads better on a short, wide map where a
  /// stack would eat most of the height.
  final Axis axis;

  /// Gap between the two circles.
  ///
  /// They are SEPARATE buttons now, not two halves of one pill. A joined pill
  /// needed a hairline divider to say "these are different controls"; discs
  /// with air between them say it without the extra line.
  ///
  /// 8, down from 10 with the buttons themselves — a compact stack.
  static const double gap = 8;

  @override
  Widget build(BuildContext context) {
    final spaced = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) {
        spaced.add(axis == Axis.vertical
            ? const SizedBox(height: gap)
            : const SizedBox(width: gap));
      }
      spaced.add(children[i]);
    }

    return axis == Axis.vertical
        ? Column(mainAxisSize: MainAxisSize.min, children: spaced)
        : Row(mainAxisSize: MainAxisSize.min, children: spaced);
  }
}

/// One circular map action — `w-11 h-11 rounded-full bg-white shadow-md border`.
///
/// 44x44 is the accessibility floor on both platforms, and these are tapped
/// one-handed outdoors, often in a hurry, which is the worst case for landing a
/// small target. The white is SOLID, not frosted: these sit on satellite
/// imagery by default, and a translucent disc over a dark roof loses its glyph.
class MapControlButton extends StatelessWidget {
  const MapControlButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;

  /// Doubles as the screen-reader label, so it has to read as an ACTION
  /// ("Switch to Satellite"), not as a name for the icon.
  final String tooltip;

  final VoidCallback onTap;

  /// 40px. Down from 44 — these float ON the imagery rather than sitting in a
  /// toolbar, and at 44 a stack of two ate a visible corner of a map that is
  /// already sharing the screen with a draggable sheet. 40 is the size every
  /// other circular control in the app uses, and it is still a comfortable
  /// thumb target on the largest uncovered region of the map.
  ///
  /// Note this is below the 44px WCAG 2.5.8 / iOS HIG figure, which is a real
  /// (small) trade: unlike the header bell — where a 40px disc sits inside a
  /// 44px hit box — these are round, adjacent, and inside a Material/InkWell
  /// whose ripple is bounded by the shape, so growing the target without
  /// growing the disc would put two overlapping hit areas 4px apart. 40 with
  /// [MapControlCluster]'s gap between them is the better of the two.
  ///
  /// 36 since the compact-controls pass: the stack sits on the imagery and at
  /// 40 it hid tiles and incident markers along the right edge. Further from
  /// the 44 guideline, a trade made knowingly for an always-visible map.
  static const double size = 36;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: tooltip,
      child: Tooltip(
        message: tooltip,
        child: Material(
          // `bg-white/90` — translucent so the imagery reads faintly through
          // and the control belongs to the map rather than hovering apart from
          // it. Opaque white was fine on a bordered card and reads as a sticker
          // on full-bleed satellite.
          color: AppColors.backgroundSecondary.withValues(alpha: 0.90),
          shape: const CircleBorder(),
          // `shadow-md`. Kept deliberately, and NOT in tension with the
          // no-shadow rule elsewhere: that rule is about focus states on form
          // inputs, where a shadow lifted a field off the page for no reason.
          // A control genuinely floating above a map is the one place
          // elevation is describing something true.
          elevation: 3,
          shadowColor: AppColors.glassShadow,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: () {
              HapticFeedback.selectionClick();
              onTap();
            },
            child: Container(
              width: size,
              height: size,
              alignment: Alignment.center,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                // The hairline is what keeps a white disc from dissolving into
                // pale imagery — an overexposed roof or a concrete road.
                border: Border.fromBorderSide(
                  BorderSide(color: AppColors.innerStroke),
                ),
              ),
              // `text-slate-700`. Was primaryDark (emerald) — a green glyph on
              // a white disc over green-tinted satellite imagery is the least
              // separable combination available. Slate reads on any basemap.
              child: Icon(icon, size: 16, color: AppColors.neutralIcon),
            ),
          ),
        ),
      ),
    );
  }
}

/// The map action glyphs, forwarded from [AppIcons].
///
/// Kept as a named surface because the map call sites read better for it
/// (`MapActionIcons.toStreets` says which map it means), but the glyphs
/// themselves now live in the app-wide registry so a map icon and a settings
/// icon cannot end up at different weights.
///
/// Both toggle glyphs name the DESTINATION, never the current state. An icon
/// showing what you are already looking at is a coin flip the resident gets
/// wrong half the time; the tooltip and semantics label say it in words for
/// anyone the picture does not reach.
class MapActionIcons {
  MapActionIcons._();

  /// Recentre on the resident's live position.
  static const IconData currentLocation = AppIcons.currentLocation;

  /// Switch to the streets basemap — shown WHILE SATELLITE IS ACTIVE.
  static const IconData toStreets = AppIcons.toStreets;

  /// Switch to satellite — shown while streets is active.
  static const IconData toSatellite = AppIcons.toSatellite;
}
