import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The app's single dismiss control — a bold X in a soft grey disc.
///
/// The counterpart to [ModernBackButton]: that one goes BACK through a stack,
/// this one CLOSES something that was laid over the stack. Sheets, modals,
/// full-screen viewers.
///
/// ── WHY IT IS ONE WIDGET ──────────────────────────────────────────────────
/// There were four dismiss buttons in the app and no two matched. A bare 22px
/// icon in an `IconButton` on the terms sheet; a 15px icon in a 30px white disc
/// with an emerald border on the announcement sheet; a plain white glyph in an
/// AppBar `leading` slot on each media viewer — which also put "close" on the
/// LEFT, where every other screen puts "back". A dismiss control that moves
/// between screens is a dismiss control the user has to find each time.
///
/// ── WHAT IS DELIBERATELY NOT THIS WIDGET ──────────────────────────────────
/// An X glyph does not always mean "close the thing you are looking at". The
/// codebase also uses one to clear a search field, to detach an uploaded ID,
/// and to remove a photo from a report. Those are *destructive edits to
/// content*, not dismissals, and they belong inline with the content they act
/// on — a 36px grey disc floating over a 64px thumbnail would be both wrong and
/// enormous. They keep their own small inline glyphs on purpose.
class ModernCloseButton extends StatefulWidget {
  const ModernCloseButton({
    super.key,
    this.onPressed,
    this.size = 36,
    this.onDark = false,
    this.semanticLabel = 'Close',
  });

  /// Defaults to popping the route — the overwhelmingly common case for a
  /// control whose entire job is "get rid of this".
  final VoidCallback? onPressed;

  /// `w-9 h-9`. The artwork, not the touch target — see [minTouchTarget].
  final double size;

  /// For full-screen viewers on black. A slate-100 disc vanishes on a photo;
  /// this swaps to translucent white so the control stays findable over
  /// arbitrary image content.
  final bool onDark;

  final String semanticLabel;

  /// Minimum interactive footprint, independent of the visual [size].
  ///
  /// The disc is 36px, under the 44px both platforms' accessibility guidance
  /// asks for. Rather than inflate the artwork past the spec, the hit area is
  /// widened around it — identical on screen, 20% easier to land. Same trick
  /// [ModernBackButton] uses, and for the same reason.
  static const double minTouchTarget = 44;

  @override
  State<ModernCloseButton> createState() => _ModernCloseButtonState();
}

class _ModernCloseButtonState extends State<ModernCloseButton>
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
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final target = widget.size > ModernCloseButton.minTouchTarget
        ? widget.size
        : ModernCloseButton.minTouchTarget;

    return Semantics(
      button: true,
      label: widget.semanticLabel,
      child: Tooltip(
        message: widget.semanticLabel,
        child: GestureDetector(
          // Opaque on the padded box, not the disc: the whole 44px square is
          // the target, including the transparent margin around the artwork.
          behavior: HitTestBehavior.opaque,
          onTapDown: (_) => _controller.forward(),
          onTapUp: (_) => _controller.reverse(),
          onTapCancel: () => _controller.reverse(),
          onTap: _handleTap,
          child: SizedBox(
            width: target,
            height: target,
            child: Center(child: _disc()),
          ),
        ),
      ),
    );
  }

  Widget _disc() {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        // `bg-slate-100` deepening to `bg-slate-200` on press — the touch
        // equivalent of the spec's `hover:bg-slate-200`. Flutter has no hover
        // state on a phone, so the darker tone is spent where it can actually
        // be seen: under the finger.
        final fill = widget.onDark
            ? Color.lerp(
                Colors.white.withValues(alpha: 0.16),
                Colors.white.withValues(alpha: 0.28),
                _press.value,
              )!
            : Color.lerp(
                AppColors.neutralFill,
                AppColors.neutralFillPressed,
                _press.value,
              )!;

        final iconColor =
            widget.onDark ? Colors.white : AppColors.neutralIcon;

        return Transform.scale(
          scale: _scale.value,
          child: Container(
            width: widget.size,
            height: widget.size,
            alignment: Alignment.center,
            decoration: BoxDecoration(shape: BoxShape.circle, color: fill),
            child: Icon(
              AppIcons.close,
              size: widget.size * 0.47,
              color: iconColor,
            ),
          ),
        );
      },
    );
  }
}
