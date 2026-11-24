import 'package:flutter/material.dart';

/// Text that SHRINKS to fit its box instead of ellipsizing.
///
/// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
/// The dashboard header shows the resident's FULL name — the one the HOA
/// office verified and the one a guard matches a report to — at the largest
/// size on the screen, in a box whose width is whatever is left after a 52px
/// avatar and a 44px bell. On a 360dp handset that is around 190dp, and a
/// perfectly ordinary Filipino name ("Ma. Cristina Villanueva-Reyes") does not
/// fit in it at 20px. What shipped was `maxLines: 1` + `TextOverflow.ellipsis`,
/// so the header identified those residents as "Ma. Cristina Vill…".
///
/// An ellipsis is the right answer for a body paragraph and the wrong one for
/// a name: the clipped half is not detail, it IS the identification. Same for
/// a page title, which names the screen you are on.
///
/// ── WHY NOT FittedBox ─────────────────────────────────────────────────────
/// `FittedBox(fit: BoxFit.scaleDown)` scales the RASTERISED text, so a name
/// that needs 70% comes out at 70% of every dimension — stroke weights and
/// letter-spacing included — and reads as a blurry squeeze rather than as
/// smaller type. This re-lays the text out at a smaller font size, which is
/// what a designer would do by hand: the hinting, spacing and weight stay
/// correct at whatever size wins.
///
/// ── THE SEARCH ────────────────────────────────────────────────────────────
/// Step down from the requested size in [stepGranularity] increments until the
/// string fits in [maxLines], then stop. It is a linear scan rather than a
/// binary search on purpose: the answer is nearly always the FIRST candidate
/// (most names fit at full size), so the common case costs one layout, and the
/// worst case — a very long name against [minFontSize] — is a couple of dozen
/// layouts of one short string, which is nothing next to the image decode this
/// header already does on the same frame.
///
/// [minFontSize] is a floor, not a guarantee. A string that still does not fit
/// at the floor ellipsizes, because painting past the box would be worse than
/// clipping — but the floor is set low enough that reaching it means the box
/// itself is wrong.
class AutoFitText extends StatelessWidget {
  const AutoFitText({
    super.key,
    required this.data,
    required this.style,
    this.maxLines = 2,
    this.minFontSize = 12,
    this.stepGranularity = 0.5,
    this.textAlign,
    this.semanticsLabel,
  })  : assert(minFontSize > 0),
        assert(stepGranularity > 0);

  final String data;

  /// Must carry a `fontSize` — it is the ceiling the search starts from.
  final TextStyle style;

  /// How many lines the text may WRAP to before it has to shrink. The header's
  /// name runs at 2; a single-line label passes 1 and gets pure scaling.
  final int maxLines;

  /// The floor. Below this the text ellipsizes rather than shrinking further.
  final double minFontSize;

  final double stepGranularity;
  final TextAlign? textAlign;

  /// What a screen reader announces. Always the FULL string, whatever size the
  /// search settles on.
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final ceiling = style.fontSize ?? 14.0;
    final direction = Directionality.of(context);
    final scaler = MediaQuery.textScalerOf(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        // An unbounded box cannot overflow horizontally, so there is nothing
        // to fit to and the scan would run to the floor for no reason.
        if (!constraints.maxWidth.isFinite) {
          return _text(ceiling, ellipsize: false);
        }

        var size = ceiling;
        var fits = false;

        while (size >= minFontSize) {
          final painter = TextPainter(
            text: TextSpan(text: data, style: style.copyWith(fontSize: size)),
            maxLines: maxLines,
            textAlign: textAlign ?? TextAlign.start,
            textDirection: direction,
            textScaler: scaler,
          )..layout(maxWidth: constraints.maxWidth);
          final overflows =
              painter.didExceedMaxLines || painter.width > constraints.maxWidth;
          painter.dispose();

          if (!overflows) {
            fits = true;
            break;
          }
          size -= stepGranularity;
        }

        // Nothing fit down to the floor. Render AT the floor and let it clip —
        // see the note on [minFontSize].
        return _text(fits ? size : minFontSize, ellipsize: !fits);
      },
    );
  }

  Widget _text(double size, {required bool ellipsize}) {
    return Text(
      data,
      maxLines: maxLines,
      // `visible`, not `clip`: when the search succeeded the text provably fits,
      // and an overflow mode is then only ever a rounding hazard on the last
      // pixel of the last glyph.
      overflow: ellipsize ? TextOverflow.ellipsis : TextOverflow.visible,
      softWrap: maxLines > 1,
      textAlign: textAlign,
      semanticsLabel: semanticsLabel,
      style: style.copyWith(fontSize: size),
    );
  }
}
