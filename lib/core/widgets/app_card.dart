import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// THE container. One definition of what a card looks like in this app.
///
/// Announcements, notification tiles, settings groups and profile cards all
/// render through this, which is what makes "they match" a structural fact
/// rather than three files that happen to agree today. Before it, the same
/// three surfaces carried three radii (5 / 14 / 16), two border colours
/// (emerald-100 and slate-100) and two stroke widths, and each pass at
/// "make them consistent" fixed one and missed another.
///
/// ── THE SPEC, IN ONE PLACE ────────────────────────────────────────────────
///   radius  [AppRadius.md] — 14px, inside the 12–16px band, and already what
///           the Settings rows used. Everything now derives from this one
///           constant, so changing the app's card radius is a one-line edit.
///   border  [AppColors.borderNeutral] — slate-200, at [AppStroke.card] (1.5).
///           Neutral grey: a card is structure, and structure should not carry
///           brand colour. The emerald hairline this replaced tinted every
///           surface in the app faintly green.
///   shadow  [AppShadows.sm] — black at 5%. Contact, not drop.
///
/// ── TACTILITY ─────────────────────────────────────────────────────────────
/// Passing [onTap] makes the card a control: it scales to 0.98 under the
/// finger over 150ms and fires a selection haptic. Omitting [onTap] leaves it
/// an inert surface with no press state at all.
///
/// That split is deliberate and load-bearing. A press animation is a PROMISE
/// that something will happen; putting one on a card that does nothing is the
/// interface lying about itself. It is specifically why the notification tiles
/// pass no [onTap] — they are read-only alert cards, so they get the border and
/// the radius and none of the feedback.
///
/// ── WHY SCALE RATHER THAN A RIPPLE ────────────────────────────────────────
/// An InkWell ripple is drawn INSIDE the card's bounds and is clipped by its
/// radius, so on a large card the splash reads as a wash crawling across the
/// content rather than as the card responding. Scaling moves the whole object,
/// which is what "tactile" means on a surface this size. Rows inside a group
/// keep their ripple — see SettingsRow — because there the ripple IS the row.
class AppCard extends StatefulWidget {
  const AppCard({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.padding = const EdgeInsets.all(16),
    this.color,
    this.borderColor,
    this.borderWidth,
    this.showBorder = true,
    this.showShadow = true,
    this.shadows,
    this.cornerRadius,
    this.clipContents = false,
  });

  final Widget child;

  /// Null makes this an inert surface: no press scale, no haptic, no
  /// [Semantics] button role.
  final VoidCallback? onTap;

  /// Optional secondary action — a destructive one, typically.
  ///
  /// Carries a heavier haptic than [onTap] deliberately. A long press has no
  /// visual affordance at all, so the only confirmation that it registered is
  /// the one felt in the hand, and a selection click is too light to read as
  /// "something is about to happen".
  final VoidCallback? onLongPress;

  final EdgeInsetsGeometry padding;

  /// Defaults to [AppColors.backgroundSecondary] — opaque white.
  final Color? color;

  /// Defaults to [AppColors.borderNeutral] — slate-200. Override only for a
  /// card that is genuinely signalling state (a destructive confirm, say), not
  /// for decoration.
  final Color? borderColor;

  /// Overrides [AppStroke.card] (1.5). Pair it with a lighter [borderColor]:
  /// weight and shade are one decision, and 1.5px is tuned for slate-200. The
  /// same 1.5px in slate-100 is a wide grey smudge rather than a faint line,
  /// while slate-100 at [AppStroke.hairline] is the barely-there rule that
  /// colour was chosen to be.
  final double? borderWidth;

  /// False drops the stroke entirely, leaving the card defined by its fill and
  /// its shadow alone — the "borderless elevated" treatment.
  ///
  /// ── WHEN TO REACH FOR IT ─────────────────────────────────────────────────
  /// A hairline and a drop shadow are two ways of saying the same thing, and
  /// which one is right depends on how much a surface has to lift. A settings
  /// group or a notification tile SITS on the page: it is a region, the stroke
  /// draws its edge, and [AppShadows.sm] just keeps it from looking pasted on.
  /// A card in a scrolling feed of peers has to read as a discrete object, and
  /// there the stroke boxes it — outline plus shadow is belt and braces, and
  /// the outline is the half that flattens.
  ///
  /// Pair this with [shadows] at [AppShadows.md]: with no stroke the shadow is
  /// the ONLY thing separating a white card from a white page, so the sm token
  /// (black at 5%) leaves the card looking like it has merged into the canvas.
  final bool showBorder;

  final bool showShadow;

  /// Overrides the default [AppShadows.sm]. Ignored when [showShadow] is false.
  final List<BoxShadow>? shadows;

  /// Overrides the app-wide [AppCard.radius]. For surfaces that are
  /// deliberately softer than the standard card — a borderless elevated card
  /// carries its corner more visibly than an outlined one, because the shadow
  /// traces it.
  ///
  /// Named for the corner rather than matching the static token it overrides:
  /// Dart forbids an instance member sharing a name with a static one on the
  /// same class, and [AppCard.radius] is the more useful of the two to keep,
  /// being what external callers build their own `BorderRadius` from.
  final double? cornerRadius;

  /// Clips children to the corner radius. Needed only when a child paints to
  /// the card's edge — a full-bleed image — because a child's own background
  /// will otherwise square off the corner it sits in. Off by default: clipping
  /// forces a save layer, and most cards are padded and never touch the edge.
  final bool clipContents;

  /// The one radius. Exposed so callers that must build their own
  /// [BorderRadius] — a ClipRRect around a header image, say — derive it from
  /// here instead of retyping the number.
  static const double radius = AppRadius.md;

  static BorderRadius get borderRadius => BorderRadius.circular(radius);

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  bool _pressed = false;

  bool get _interactive => widget.onTap != null || widget.onLongPress != null;

  /// The shortest a press is held down on screen.
  ///
  /// A quick tap delivers tap-down and tap-up within a frame or two of each
  /// other (inside a scroll view, tap-down is even held back until the
  /// finger lifts), so the 0.98 press scale was set and cleared before it
  /// could paint. The card then opened its modal with no visible
  /// acknowledgement, which reads as the app jumping rather than responding.
  /// Holding the press this long lets the dip actually show.
  static const Duration _minPress = Duration(milliseconds: 100);

  DateTime? _pressedAt;
  Timer? _releaseTimer;

  void _setPressed(bool value) {
    if (!_interactive) return;
    if (value) {
      _releaseTimer?.cancel();
      _pressedAt = DateTime.now();
      if (!_pressed) setState(() => _pressed = true);
      return;
    }
    if (!_pressed) return;
    final held = _pressedAt == null
        ? _minPress
        : DateTime.now().difference(_pressedAt!);
    if (held >= _minPress) {
      setState(() => _pressed = false);
      return;
    }
    _releaseTimer?.cancel();
    _releaseTimer = Timer(_minPress - held, () {
      if (mounted) setState(() => _pressed = false);
    });
  }

  @override
  void dispose() {
    _releaseTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final card = AnimatedScale(
      scale: _pressed ? 0.98 : 1,
      duration: const Duration(milliseconds: 150),
      curve: Curves.easeOut,
      child: Container(
        padding: widget.padding,
        clipBehavior: widget.clipContents ? Clip.antiAlias : Clip.none,
        decoration: BoxDecoration(
          color: widget.color ?? AppColors.backgroundSecondary,
          borderRadius: widget.cornerRadius == null
              ? AppCard.borderRadius
              : BorderRadius.circular(widget.cornerRadius!),
          border: widget.showBorder
              ? Border.all(
                  color: widget.borderColor ?? AppColors.borderNeutral,
                  width: widget.borderWidth ?? AppStroke.card,
                )
              : null,
          boxShadow: widget.showShadow
              ? (widget.shadows ?? AppShadows.sm)
              : null,
        ),
        child: widget.child,
      ),
    );

    if (!_interactive) return card;

    return Semantics(
      button: true,
      child: GestureDetector(
        // `opaque` so the whole card area is the target, including the gaps
        // between its children — without it a press that lands on padding
        // falls through and the card silently ignores taps near its edges.
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _setPressed(true),
        onTapUp: (_) => _setPressed(false),
        // Fires on drag-off as well as on a genuine cancel, which is what
        // releases the scale when a press turns into a list scroll.
        // Immediately, not after the minimum hold: a cancelled press is a
        // scroll, and the card should let go the moment the list moves.
        onTapCancel: () {
          _releaseTimer?.cancel();
          if (_pressed) setState(() => _pressed = false);
        },
        onTap: widget.onTap == null
            ? null
            : () {
                HapticFeedback.selectionClick();
                widget.onTap!();
              },
        onLongPress: widget.onLongPress == null
            ? null
            : () {
                // Releases the press scale first. Without it the card stays
                // squashed under whatever the long press opens, and is still
                // squashed when that closes.
                _setPressed(false);
                HapticFeedback.mediumImpact();
                widget.onLongPress!();
              },
        child: card,
      ),
    );
  }
}
