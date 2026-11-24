import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// One destination in [CurvedBottomNav].
///
/// ONE glyph, always filled. This used to carry an `icon`/`activeIcon` pair —
/// outline when idle, solid when selected — which the Soft Modernism icon
/// system replaces: every glyph in the app is solid, and selection is carried
/// by colour and label weight instead. Keeping the pair would have meant
/// passing the same filled glyph twice at every call site.
class CurvedNavItem {
  const CurvedNavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.selected = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool selected;
}

/// The app's bottom navigation: a white bar with a smooth notch cradling a
/// floating emergency button.
///
/// ── No longer an inverted surface ─────────────────────────────────────────
/// This bar used to carry its own private white/slate ramp, because it was the
/// one light surface in an ultra-dark shell. The whole app is now Soft
/// Modernism green-and-white, so that private ramp described the same colours
/// [AppColors] does — two definitions of white, drifting apart on the next
/// palette change. It reads the shared tokens now.
class CurvedBottomNav extends StatelessWidget {
  const CurvedBottomNav({
    super.key,
    required this.items,
    required this.onSos,
    this.sosLabel = 'SOS',
  });

  /// An EVEN number of destinations, split down the middle: the first half
  /// renders left of the notch, the second half right of it.
  ///
  /// Even is a hard requirement, not a preference. An odd count cannot be
  /// distributed symmetrically about a centred button — one side gets an extra
  /// slot, the notch stops being the midpoint of the bar, and the SOS button
  /// ends up off-centre relative to the tabs it sits between.
  final List<CurvedNavItem> items;

  /// Fired by the floating centre button. This is an emergency trigger — it
  /// should reach the alert dispatcher without an intermediate confirmation.
  final VoidCallback onSos;

  final String sosLabel;

  // ── Shared tokens (see the class doc) ──
  static const Color _surface = AppColors.backgroundSecondary;
  /// Selected tab: vibrant emerald, filled.
  static const Color _labelActive = AppColors.accentPrimary;
  /// Idle tab: muted slate, still a FILLED glyph — the Soft Modernism icon
  /// system distinguishes states by colour, never by outline-vs-solid.
  static const Color _labelIdle = AppColors.textMuted;

  /// Bar height above the safe-area inset.
  static const double barHeight = 68;

  /// Diameter of the floating button.
  static const double sosDiameter = 58;

  /// How far the button's top sits above the bar's top edge.
  static const double sosOverhang = 30;

  /// Top corner radius of the bar.
  static const double cornerRadius = 24;

  /// Half-width and depth of the scoop. Sized so the [sosDiameter] circle
  /// clears the cut edge by ~7px on every side — the gap that makes the button
  /// read as cradled rather than jammed into a hole.
  static const double _notchHalfWidth = 43;
  static const double _notchDepth = 25;

  @override
  Widget build(BuildContext context) {
    assert(items.length.isEven && items.length >= 2,
        'CurvedBottomNav needs an even number of items to split about the notch.');

    final half = items.length ~/ 2;
    // Six slots have to share the width four used to. Shrinking the glyph and
    // the label together keeps their optical relationship intact — dropping
    // only the type would leave outsized icons over cramped words.
    final dense = items.length > 4;
    final iconSize = dense ? 20.0 : 22.0;
    final labelSize = dense ? 9.5 : 11.0;

    final bottomInset = MediaQuery.of(context).padding.bottom;
    final totalBarHeight = barHeight + bottomInset;

    return SizedBox(
      height: totalBarHeight + sosOverhang,
      child: Stack(
        // The button is drawn outside the Stack's own bounds on purpose.
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: PhysicalShape(
              // PhysicalShape, not a Container with a boxShadow: the shadow has
              // to follow the NOTCH. A rectangular shadow behind a clipped bar
              // paints a straight dark edge across the scoop, which is exactly
              // the seam the cradle exists to avoid.
              clipper: const _NotchedBarClipper(
                cornerRadius: cornerRadius,
                notchHalfWidth: _notchHalfWidth,
                notchDepth: _notchDepth,
              ),
              elevation: 10,
              color: _surface,
              // Emerald-tinted rather than black: on a white bar over a white
              // shell, a black shadow reads as grime along the top edge.
              shadowColor: AppColors.primaryDark.withValues(alpha: 0.18),
              child: SizedBox(
                height: totalBarHeight,
                child: Padding(
                  // Safe-area padding lives INSIDE the painted surface, so the
                  // white extends behind the gesture bar rather than floating
                  // above a strip of dark shell.
                  padding: EdgeInsets.only(bottom: bottomInset),
                  child: Row(
                    children: [
                      for (final item in items.take(half))
                        Expanded(
                            child: _tab(item, iconSize: iconSize, labelSize: labelSize)),
                      // Reserves the notch's footprint so the labels sit
                      // symmetrically about the button instead of being pushed
                      // off-centre by it.
                      const SizedBox(width: _notchHalfWidth * 2),
                      for (final item in items.skip(half))
                        Expanded(
                            child: _tab(item, iconSize: iconSize, labelSize: labelSize)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: Center(child: _sosButton()),
          ),
        ],
      ),
    );
  }

  Widget _tab(
    CurvedNavItem item, {
    required double iconSize,
    required double labelSize,
  }) {
    final color = item.selected ? _labelActive : _labelIdle;
    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        item.onTap();
      },
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        // Full bar height, so the tap target is the whole column rather than
        // just the glyph.
        height: barHeight,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(item.icon, size: iconSize, color: color),
            const SizedBox(height: 5),
            Padding(
              // A hair of breathing room so a long label ends before it touches
              // its neighbour rather than at the exact slot boundary.
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: sfPro(
                  fontSize: labelSize,
                  // Weight carries selection along with colour: on a white bar
                  // at arm's length, slate-900 against slate-400 is a smaller
                  // signal than it looks on a desk.
                  fontWeight: item.selected ? FontWeight.w700 : FontWeight.w500,
                  color: color,
                  letterSpacing: -0.1,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sosButton() {
    return _PressScale(
      onTap: () {
        // Heavy, not selection-light. This is the one control in the app whose
        // press must be felt through a pocket.
        HapticFeedback.heavyImpact();
        onSos();
      },
      child: Semantics(
        button: true,
        label: 'Emergency SOS',
        child: Container(
          width: sosDiameter,
          height: sosDiameter,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            // SOLID RED, not the near-black disc this used to be.
            //
            // That disc was `AppColors.background`, chosen when the surface was
            // near-black. Re-pointing the palette to green-and-white would have
            // turned it into a white circle carrying white text on a white bar
            // — invisible. A dark-disc-with-red-ring also stops making sense
            // once nothing else on screen is dark: on a white bar the emergency
            // control should be the one saturated fill in the layout, which is
            // what the spec's "dedicated accent fills" asks for.
            color: AppColors.panicOxblood,
            border: Border.all(color: AppColors.onAccent, width: 3),
            boxShadow: const [
              // Soft neutral lift…
              BoxShadow(
                color: AppColors.glassShadow,
                blurRadius: 16,
                offset: Offset(0, 6),
              ),
              // …plus a red bloom, so the button glows rather than casting a
              // grey smudge across the white bar.
              BoxShadow(
                color: AppColors.panicGlowOuter,
                blurRadius: 18,
                spreadRadius: -1,
              ),
            ],
          ),
          child: Text(
            sosLabel,
            style: sfPro(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.onAccent,
              letterSpacing: 0.6,
              height: 1,
            ),
          ),
        ),
      ),
    );
  }
}

/// The SOS button's press: it sinks to 92% under the finger and springs back,
/// so the one control that must never feel ignored answers on touch-down —
/// before the countdown sheet has had time to open. Instant under reduced
/// motion; the haptic still fires.
class _PressScale extends StatefulWidget {
  const _PressScale({required this.child, required this.onTap});

  final Widget child;
  final VoidCallback onTap;

  @override
  State<_PressScale> createState() => _PressScaleState();
}

class _PressScaleState extends State<_PressScale> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _set(true),
      onTapUp: (_) => _set(false),
      onTapCancel: () => _set(false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down ? 0.92 : 1,
        duration: Duration(milliseconds: reduce ? 0 : (_down ? 90 : 180)),
        curve: _down ? Curves.easeOut : Curves.easeOutBack,
        child: widget.child,
      ),
    );
  }
}

/// Rounded-top bar with a concave scoop cut into its top edge.
///
/// The scoop is two mirrored cubic Béziers whose control points share their
/// neighbouring anchor's Y coordinate. That is what keeps the curve
/// tangent-continuous — without it there is a visible kink where the arc meets
/// the flat edge, and a second at the valley floor.
class _NotchedBarClipper extends CustomClipper<Path> {
  const _NotchedBarClipper({
    required this.cornerRadius,
    required this.notchHalfWidth,
    required this.notchDepth,
  });

  final double cornerRadius;
  final double notchHalfWidth;
  final double notchDepth;

  @override
  Path getClip(Size size) {
    final w = size.width;
    final h = size.height;
    final cx = w / 2;
    final r = cornerRadius;

    return Path()
      ..moveTo(0, h)
      ..lineTo(0, r)
      ..quadraticBezierTo(0, 0, r, 0)
      ..lineTo(cx - notchHalfWidth, 0)
      ..cubicTo(
        cx - notchHalfWidth * 0.5, 0,
        cx - notchHalfWidth * 0.5, notchDepth,
        cx, notchDepth,
      )
      ..cubicTo(
        cx + notchHalfWidth * 0.5, notchDepth,
        cx + notchHalfWidth * 0.5, 0,
        cx + notchHalfWidth, 0,
      )
      ..lineTo(w - r, 0)
      ..quadraticBezierTo(w, 0, w, r)
      ..lineTo(w, h)
      ..close();
  }

  @override
  bool shouldReclip(covariant _NotchedBarClipper old) =>
      old.cornerRadius != cornerRadius ||
      old.notchHalfWidth != notchHalfWidth ||
      old.notchDepth != notchDepth;
}
