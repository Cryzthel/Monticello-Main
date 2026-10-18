import 'dart:ui';

import 'package:flutter/material.dart';

/// The two halves of every blurred modal in the app, animated separately.
///
/// ── WHY THE BACKDROP AND THE CARD CANNOT SHARE ONE TRANSITION ─────────────
/// Both modals (Sign Out, and the announcement / notification focus modal)
/// used to wrap their WHOLE page — blur layer and card together — in one
/// `FadeTransition`. Two things went wrong with that, and both read as the
/// "sudden cut" at the end of the entrance:
///
///   1. A BackdropFilter under an opacity layer has nothing to blur. The
///      opacity layer is a saveLayer of its own, so the filter samples an
///      empty buffer, and the page behind stays SHARP for the whole fade.
///      FadeTransition drops the layer at exactly 1.0 — and on that frame the
///      full 6σ blur appears at once.
///   2. The Sign Out dialog also scaled the page from 0.96, which shrank the
///      full-screen blur layer and showed unblurred strips at every edge
///      until the scale finished.
///
/// So the backdrop never sits under an opacity or a transform: the blur's
/// sigma and the scrim's alpha are driven straight from the route animation
/// ([BlurModalBackdrop]), and only the card fades and moves
/// ([ModalCardEntrance]). The blur deepens with the fade instead of landing
/// on the last frame.
///
/// Both read the route's animation from [ModalRoute.of], so the dialog's own
/// `transitionBuilder` passes its child through untouched.

/// The shared curve. Ease-out in (fast start, gentle landing — the card
/// arrives under the finger that asked for it), ease-in out (it leaves
/// without lingering).
Animation<double> _curved(BuildContext context) {
  final route = ModalRoute.of(context)?.animation;
  if (route == null) return kAlwaysCompleteAnimation;
  return CurvedAnimation(
    parent: route,
    curve: Curves.easeOutCubic,
    reverseCurve: Curves.easeInCubic,
  );
}

/// Blur + scrim behind a modal, both scaled by the entrance progress.
class BlurModalBackdrop extends StatelessWidget {
  const BlurModalBackdrop({
    super.key,
    required this.onTap,
    this.sigma = 8,
    this.scrimOpacity = 0.45,
  });

  final VoidCallback onTap;

  /// Full blur strength, reached when the entrance completes.
  final double sigma;

  /// Full scrim alpha, likewise.
  final double scrimOpacity;

  @override
  Widget build(BuildContext context) {
    final progress = _curved(context);
    return GestureDetector(
      onTap: onTap,
      child: AnimatedBuilder(
        animation: progress,
        builder: (context, _) {
          final t = progress.value.clamp(0.0, 1.0);
          final scrim = ColoredBox(
            color: Colors.black.withValues(alpha: scrimOpacity * t),
            child: const SizedBox.expand(),
          );
          // No filter at all at rest: a zero-sigma BackdropFilter still costs
          // a full-screen pass for nothing.
          if (t <= 0.001) return scrim;
          return BackdropFilter(
            filter: ImageFilter.blur(sigmaX: sigma * t, sigmaY: sigma * t),
            child: scrim,
          );
        },
      ),
    );
  }
}

/// Fades the card in and moves it by [scaleFrom] / [slideFrom].
///
/// Scale for a compact centred dialog (Sign Out): it grows from where the eye
/// already is. A short rise for a large card (the focus modal): scaling a
/// near-full-width card reads as the whole page zooming.
class ModalCardEntrance extends StatelessWidget {
  const ModalCardEntrance({
    super.key,
    required this.child,
    this.scaleFrom = 1,
    this.slideFrom = Offset.zero,
  });

  final Widget child;

  /// Never below ~0.95: anything smaller reads as the card popping out of
  /// nowhere rather than settling into place.
  final double scaleFrom;

  /// As a fraction of the card's own size.
  final Offset slideFrom;

  @override
  Widget build(BuildContext context) {
    final progress = _curved(context);
    Widget card = FadeTransition(opacity: progress, child: child);
    if (scaleFrom != 1) {
      card = ScaleTransition(
        scale: Tween<double>(begin: scaleFrom, end: 1).animate(progress),
        child: card,
      );
    }
    if (slideFrom != Offset.zero) {
      card = SlideTransition(
        position: Tween<Offset>(begin: slideFrom, end: Offset.zero)
            .animate(progress),
        child: card,
      );
    }
    return card;
  }
}
