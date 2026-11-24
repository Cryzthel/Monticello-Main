import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The app's single, global back-navigation control — a bold chevron in a
/// frosted white circle with an emerald hairline and a soft drop shadow. This
/// is the one back-button treatment used everywhere the app needs a "go back"
/// affordance: AppBar `leading` slots, custom headers, and standalone floating
/// controls. Restyling here restyles every screen at once, which is the whole
/// reason it is one widget.
///
/// A single [AnimationController] drives the entire press interaction: the
/// button scales to 0.95, its fill goes from white/90 to solid and the hairline
/// warms toward the accent, then everything springs back on release. No nested
/// controllers, no rebuild of anything outside this widget.
///
/// Pops the current route by default; pass [onPressed] to override with custom
/// behavior (e.g. a multi-step wizard's "previous step"), or [onNothingToPop]
/// for screens that are sometimes a route and sometimes not.
///
/// ── THE DEAD BUTTON ───────────────────────────────────────────────────────
/// This used to read `if (canPop()) pop();` and was documented as "a safe
/// no-op with nothing to pop back to". Silence is not safe here. History is
/// rendered as a TAB inside the home shell rather than pushed onto the
/// navigator, so `canPop()` was false and its back arrow did nothing at all
/// when tapped. A control that renders, animates under the finger, and then
/// declines to act is worse than one that is absent: it tells the user the
/// screen is stuck.
///
/// The button now refuses to be silent. With nothing to pop it calls
/// [onNothingToPop]; if the host supplied no answer either, it falls back to
/// the Home route, because "back" from a dead end is still somewhere.
class ModernBackButton extends StatefulWidget {
  final VoidCallback? onPressed;

  /// What "back" means when this screen is NOT a pushed route — typically
  /// "switch the shell to the Home tab". Only consulted when [onPressed] is
  /// null and the navigator has nothing to pop.
  final VoidCallback? onNothingToPop;

  final double size;

  /// The chevron. Defaults to [AppIcons.chevronLeft] — see that registry for
  /// why the app's carets are Bold and not Fill.
  ///
  /// `matchTextDirection` is set on the glyph itself upstream, so this flips
  /// automatically under RTL rather than pointing the wrong way.
  final IconData icon;

  /// Minimum interactive footprint, independent of the visual [size].
  ///
  /// The circle is 40px, which is under the 44px both platforms' accessibility
  /// guidance asks for. Rather than inflate the artwork, the hit area is
  /// widened around it — the button looks identical and is 10% easier to land.
  static const double minTouchTarget = 44;

  const ModernBackButton({
    super.key,
    this.onPressed,
    this.onNothingToPop,
    this.size = 40,
    this.icon = AppIcons.chevronLeft,
  });

  @override
  State<ModernBackButton> createState() => _ModernBackButtonState();
}

class _ModernBackButtonState extends State<ModernBackButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;
  late final Animation<double> _press;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
      reverseDuration: const Duration(milliseconds: 220),
    );
    // 0.95, not 0.90. A tenth of the button's size is a lurch at 40px; the
    // press should read as the surface giving slightly, not as the control
    // shrinking away from the finger.
    _scale = Tween(begin: 1.0, end: 0.95).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOut),
    );
    _press = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleTap() {
    dismissKeyboard();
    if (widget.onPressed != null) {
      widget.onPressed!();
      return;
    }

    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
      return;
    }

    // Nothing to pop — this screen is a tab in the shell, not a pushed route.
    if (widget.onNothingToPop != null) {
      widget.onNothingToPop!();
      return;
    }

    // Last resort. Reaching here means a screen that can't pop also declined to
    // say what "back" means, so send the user somewhere real rather than
    // leaving the tap unanswered. The predicate clears the stack as it goes, so
    // this can never leave a second Home sitting on top of the first.
    navigator.pushNamedAndRemoveUntil('/home', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    final target = widget.size > ModernBackButton.minTouchTarget
        ? widget.size
        : ModernBackButton.minTouchTarget;

    return Semantics(
      button: true,
      label: 'Back',
      child: GestureDetector(
        // Opaque on the padded box, not the circle: the whole 44px square is
        // the target, including the transparent margin around the artwork.
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _controller.forward(),
        onTapUp: (_) => _controller.reverse(),
        onTapCancel: () => _controller.reverse(),
        onTap: _handleTap,
        child: SizedBox(
          width: target,
          height: target,
          child: Center(child: _circle()),
        ),
      ),
    );
  }

  Widget _circle() {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        // ── SOLID WHITE, NEUTRAL HAIRLINE ────────────────────────────────
        //
        // Was `bg-white/90` over a 12px backdrop blur with an emerald border.
        // Both went:
        //
        //  · The blur cost a full BackdropFilter — one of the most expensive
        //    widgets Flutter has, forcing a saveLayer on every frame — to
        //    frost 40 circular pixels of a page that is now pure white. It
        //    was blurring white behind white.
        //
        //  · The emerald hairline made a navigation control look like a
        //    brand surface. Back is chrome; it should recede. Slate-200 is
        //    what the rest of the industry puts here.
        //
        // Press still deepens the fill and warms the border, so the state
        // change survives — it is now grey→emerald rather than emerald→
        // brighter-emerald, which is a clearer signal, not a weaker one.
        final fill = Color.lerp(
          AppColors.backgroundSecondary,
          AppColors.neutralFill,
          _press.value,
        )!;
        final border = Color.lerp(
          AppColors.borderNeutral,
          AppColors.accentPrimary.withValues(alpha: 0.6),
          _press.value,
        )!;
        final iconColor = Color.lerp(
          AppColors.textPrimary,
          AppColors.accentPrimary,
          _press.value,
        )!;

        return Transform.scale(
          scale: _scale.value,
          // Shadow OUTSIDE the clip. A boxShadow paints beyond its own bounds,
          // so putting it on the Container inside a ClipOval would have it
          // clipped away entirely — the elevation would simply not render.
          child: DecoratedBox(
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: AppShadows.sm,
            ),
            child: Container(
              width: widget.size,
              height: widget.size,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: fill,
                border: Border.all(color: border, width: 1.2),
              ),
              child: Icon(
                widget.icon,
                // 0.48 — a bold chevron at ~19px in a 40px circle reads as
                // "back" at a glance, where a smaller one reads as chrome.
                size: widget.size * 0.48,
                color: iconColor,
              ),
            ),
          ),
        );
      },
    );
  }
}
