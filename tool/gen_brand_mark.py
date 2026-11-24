"""Generate lib/core/brand/brand_mark.dart from the portal's BrandMark.jsx.

The four contours are copied byte-for-byte out of the JSX so the mobile mark and
the portal mark are the same artwork, not two transcriptions of it.
"""
import re
import sys

SRC = sys.argv[1]
OUT = sys.argv[2]

jsx = open(SRC, encoding="utf-8").read()
contours = re.findall(r'<path d="([^"]+)"', jsx)
if len(contours) != 4:
    raise SystemExit("expected 4 contours, found %d" % len(contours))

viewbox = re.search(r'viewBox="0 0 (\d+) (\d+)"', jsx)
vw, vh = viewbox.group(1), viewbox.group(2)

# Only M / L / C / Z, absolute, appear in the export. Assert it, so a future
# re-export with arcs or relative commands fails here rather than rendering
# a quietly wrong mark.
letters = set(re.findall(r"[A-Za-z]", "".join(contours)))
unexpected = letters - set("MLCZe")  # `e` is exponent notation (6.86646e-05)
if unexpected:
    raise SystemExit("unsupported path commands in export: %s" % sorted(unexpected))

HEADER = '''import 'package:flutter/widgets.dart';

/// The Monticello Villas mark — the four-element rounded geometric emblem.
///
/// ── PROVENANCE ────────────────────────────────────────────────────────────
/// GENERATED, not retyped. The four contours below are a verbatim copy of
/// `web-portal/packages/shared/src/components/BrandMark.jsx`, which is itself
/// a verbatim "Copy as SVG" of node 340-69 — Logo page > Frame 3 > Group 1 >
/// "Monticello logo" — of the thesis prototype file. Regenerate with
/// `tool/gen_brand_mark.py` rather than editing the strings by hand.
///
/// This matters more than it looks like it should. The portal's copy of this
/// file documents a mark that was once built from a WRITTEN DESCRIPTION of the
/// logo ("bold, modern monogram, clean rounded outer corners, centered
/// vertical cutout line") because the artwork was not reachable at the time —
/// and the description turned out to describe a different shape entirely.
/// Nothing is reconstructed here for the same reason.
///
/// ── WHY GEOMETRY AND NOT AN IMAGE ─────────────────────────────────────────
/// The splash needs the mark in brand green on white and in pure white on
/// near-black. A PNG pair, or two SVG assets, means two files to keep in step
/// and a swap that can flash mid-transition. A single [Path] tinted by a
/// [Color] means one source of truth, a free theme switch, and a colour that
/// can be *tweened* — which is what makes the light/dark change on the splash
/// a transition rather than a cut. It also costs no new dependency:
/// `flutter_svg` is not in this project and is not needed for four contours.
///
/// ── SIZING: HEIGHT ONLY ───────────────────────────────────────────────────
/// The artwork is {VW}x{VH} — WIDER THAN IT IS TALL. Callers give [height] and
/// the width follows from the aspect ratio; there is deliberately no `width`
/// parameter, because the square box a caller would reach for first
/// letterboxes the mark and renders it a notch smaller than the height asked
/// for. That is the exact bug the portal's copy warns about.
class BrandMark extends StatelessWidget {
  const BrandMark({
    super.key,
    required this.height,
    required this.color,
    this.semanticLabel,
  });

  /// The mark's height in logical pixels. Width follows the artwork.
  final double height;

  /// The ink. Every contour is filled with it — the mark is monochrome by
  /// design, which is what lets one asset serve both themes.
  final Color color;

  /// Set this ONLY where the mark stands alone with no wordmark beside it —
  /// the splash screen, for instance. Left null the mark is decorative and
  /// excluded from the accessibility tree, so a screen reader does not
  /// announce the brand twice next to a visible "Monticello Villas".
  final String? semanticLabel;

  /// The artwork's intrinsic size, in its own coordinate space.
  static const Size artworkSize = Size({VW}, {VH});

  /// Width for a given height, at the artwork's aspect ratio.
  static double widthFor(double height) =>
      height * artworkSize.width / artworkSize.height;

  /// The four contours, parsed once per process rather than per frame.
  ///
  /// A `static final` initialiser is lazy in Dart — no `late` needed — so
  /// nothing is parsed until the first mark is painted, and the splash, which
  /// is the first thing on screen, pays for it once.
  static final List<Path> _contours = List<Path>.unmodifiable(
    _kContours.map(parseSvgPathData),
  );

  @override
  Widget build(BuildContext context) {
    final mark = SizedBox(
      height: height,
      width: widthFor(height),
      child: CustomPaint(painter: _BrandMarkPainter(color)),
    );

    if (semanticLabel == null) return ExcludeSemantics(child: mark);
    return Semantics(image: true, label: semanticLabel, child: mark);
  }
}

class _BrandMarkPainter extends CustomPainter {
  const _BrandMarkPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    canvas.save();
    canvas.scale(
      size.width / BrandMark.artworkSize.width,
      size.height / BrandMark.artworkSize.height,
    );
    // Four separate paths rather than one combined path. They are four
    // separate <path> elements in the artwork and they abut; unioning them
    // into a single non-zero-wound Path risks the seams filling or cancelling.
    for (final contour in BrandMark._contours) {
      canvas.drawPath(contour, paint);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BrandMarkPainter oldDelegate) =>
      oldDelegate.color != color;
}

/// Parses the subset of SVG path data the mark is drawn with.
///
/// Absolute `M`, `L`, `C` and `Z` only — which is everything Figma emitted for
/// this artwork, and the generator asserts that before writing this file. It is
/// NOT a general SVG path parser and should not be used as one: relative
/// commands, arcs, quadratics and the shorthand forms all throw rather than
/// silently drawing the wrong shape.
///
/// Visible for testing.
Path parseSvgPathData(String d) {
  final path = Path();
  final length = d.length;
  var i = 0;
  var x = 0.0, y = 0.0, startX = 0.0, startY = 0.0;
  String? command;

  bool isDigit(String c) => (c.codeUnitAt(0) ^ 0x30) <= 9;

  void skipSeparators() {
    while (i < length) {
      final c = d[i];
      if (c == ' ' || c == ',' || c == '\\n' || c == '\\r' || c == '\\t') {
        i++;
      } else {
        break;
      }
    }
  }

  double readNumber() {
    skipSeparators();
    final start = i;
    if (i < length && (d[i] == '-' || d[i] == '+')) i++;
    while (i < length && (isDigit(d[i]) || d[i] == '.')) {
      i++;
    }
    // Exponent notation: Figma emits coordinates like `6.86646e-05`.
    if (i < length && (d[i] == 'e' || d[i] == 'E')) {
      i++;
      if (i < length && (d[i] == '-' || d[i] == '+')) i++;
      while (i < length && isDigit(d[i])) {
        i++;
      }
    }
    if (start == i) {
      throw FormatException('Expected a number in path data', d, start);
    }
    return double.parse(d.substring(start, i));
  }

  while (i < length) {
    skipSeparators();
    if (i >= length) break;

    final c = d[i];
    if (!isDigit(c) && c != '-' && c != '+' && c != '.') {
      command = c;
      i++;
    }

    switch (command) {
      case 'M':
        x = readNumber();
        y = readNumber();
        path.moveTo(x, y);
        startX = x;
        startY = y;
        // Per the SVG spec, coordinate pairs that follow a moveto without a
        // command letter of their own are implicit linetos.
        command = 'L';
      case 'L':
        x = readNumber();
        y = readNumber();
        path.lineTo(x, y);
      case 'C':
        final x1 = readNumber();
        final y1 = readNumber();
        final x2 = readNumber();
        final y2 = readNumber();
        x = readNumber();
        y = readNumber();
        path.cubicTo(x1, y1, x2, y2, x, y);
      case 'Z':
      case 'z':
        path.close();
        x = startX;
        y = startY;
      default:
        throw FormatException(
          'Unsupported path command "$command" — this parser handles '
          'absolute M, L, C and Z only',
          d,
          i,
        );
    }
  }

  return path;
}

/// The artwork. Do not edit by hand — see the provenance note on [BrandMark].
const List<String> _kContours = <String>[
'''

parts = [HEADER.replace("{VW}", vw).replace("{VH}", vh)]
for contour in contours:
    parts.append("  '%s',\n" % contour)
parts.append("];\n")

with open(OUT, "w", encoding="utf-8", newline="\n") as handle:
    handle.write("".join(parts))

print("wrote %s (%d contours, viewBox %sx%s)" % (OUT, len(contours), vw, vh))

# ── STAGE 2: THE ANDROID 12 SPLASH ICON ──────────────────────────────────
# Optional third argument.
#
# Android 12 and later ignore `windowBackground` for the launch screen and
# draw their OWN splash from the LAUNCHER ICON. Ours is an adaptive icon: an
# emerald plate with the mark on it. So the system faithfully drew a green
# rounded square — the exact container this project had already removed from
# every surface Dart controls — and no amount of editing SplashView could
# touch it, because SplashView is not what was on screen.
#
# The fix is to hand the system a dedicated splash icon with no plate. This
# emits it. Android's `pathData` is SVG path syntax, so the contours transfer
# verbatim and the splash icon cannot drift from the Dart one.
if len(sys.argv) > 3:
    ANDROID_OUT = sys.argv[3]
    # ── THE SIZE IS FLUTTER'S, NOT THE SPEC'S MAXIMUM ────────────────
    # The canvas is 288dp because that is what the platform reserves for a
    # splash icon with no background of its own. The MARK inside it is sized
    # to match `SplashView.markHeight` exactly, and that is the whole point.
    #
    # It was 150dp, chosen as "comfortably inside the 192dp safe circle".
    # That made the system's mark about 60% wider than the one Flutter draws
    # a moment later, so a cold start showed the logo at one size, then
    # again at another — read, correctly, as the logo appearing twice. The
    # handoff between the platform splash and the first Flutter frame is
    # only invisible if the thing being handed over does not change size.
    #
    # KEEP IN STEP with `markHeight` in
    # lib/features/onboarding/widgets/splash_view.dart. 88dp tall at the
    # artwork's 192:179 ratio is 94.4dp wide.
    canvas, target_w = 288.0, 88.0 * 192.0 / 179.0
    scale = target_w / float(vw)
    off_x = (canvas - target_w) / 2
    off_y = (canvas - float(vh) * scale) / 2
    rows = "\n".join(
        '        <path\n'
        '            android:fillColor="@color/splash_mark_ink"\n'
        '            android:pathData="%s" />' % c
        for c in contours
    )
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!--\n"
        "  GENERATED by tool/gen_brand_mark.py. Do not edit.\n"
        "\n"
        "  The Android 12+ splash icon: the bare emblem, no plate behind it.\n"
        "  See the stage-2 note in the generator for why this file has to\n"
        "  exist at all.\n"
        "\n"
        "  `@color/splash_mark_ink` is appearance-qualified, so the mark is\n"
        "  emerald on the white canvas and the portals' cream on the dark one.\n"
        "-->\n"
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="%(canvas)ddp"\n'
        '    android:height="%(canvas)ddp"\n'
        '    android:viewportWidth="%(canvas)d"\n'
        '    android:viewportHeight="%(canvas)d">\n'
        "    <group\n"
        '        android:scaleX="%(scale).6f"\n'
        '        android:scaleY="%(scale).6f"\n'
        '        android:translateX="%(off_x).3f"\n'
        '        android:translateY="%(off_y).3f">\n'
        "%(rows)s\n"
        "    </group>\n"
        "</vector>\n"
    ) % {
        "canvas": int(canvas),
        "scale": scale,
        "off_x": off_x,
        "off_y": off_y,
        "rows": rows,
    }
    with open(ANDROID_OUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(xml)
    print("wrote %s (mark at %.0fdp inside %ddp)" % (ANDROID_OUT, target_w, int(canvas)))
