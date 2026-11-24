import 'package:flutter/widgets.dart';

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
/// The artwork is 192x179 — WIDER THAN IT IS TALL. Callers give [height] and
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
  static const Size artworkSize = Size(192, 179);

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
      if (c == ' ' || c == ',' || c == '\n' || c == '\r' || c == '\t') {
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
  'M148.534 20.9424C149.552 21.9775 150.36 23.2064 150.911 24.5589C151.461 25.9115 151.745 27.3611 151.745 28.825C151.745 30.289 151.461 31.7386 150.911 33.0911C150.36 34.4436 149.552 35.6725 148.534 36.7077L131.153 54.3847C130.135 55.4199 128.927 56.2411 127.597 56.8013C126.267 57.3616 124.842 57.6499 123.402 57.6499C121.963 57.6499 120.538 57.3616 119.208 56.8013C117.878 56.2411 116.669 55.4199 115.652 54.3847L103.751 42.2814C102.733 41.2462 101.525 40.425 100.195 39.8648C98.8648 39.3045 97.4395 39.0162 96 39.0162C94.5606 39.0162 93.1352 39.3045 91.8053 39.8648C90.4754 40.425 89.2671 41.2462 88.2493 42.2814L76.3484 54.3847C75.3306 55.4199 74.1222 56.2411 72.7924 56.8013C71.4625 57.3616 70.0371 57.6499 68.5977 57.6499C67.1582 57.6499 65.7328 57.3616 64.403 56.8013C63.0731 56.2411 61.8647 55.4199 60.8469 54.3847L43.4656 36.7077C42.4477 35.6725 41.6403 34.4436 41.0894 33.0911C40.5385 31.7386 40.255 30.289 40.255 28.825C40.255 27.3611 40.5385 25.9115 41.0894 24.5589C41.6403 23.2064 42.4477 21.9775 43.4656 20.9424L60.8469 3.26533C61.8647 2.23014 63.0731 1.40897 64.403 0.848725C65.7328 0.288478 67.1582 0.00012207 68.5977 0.00012207C70.0371 0.00012207 71.4625 0.288478 72.7924 0.848725C74.1222 1.40897 75.3306 2.23014 76.3484 3.26533L88.2493 15.3687C89.2671 16.4039 90.4754 17.225 91.8053 17.7853C93.1352 18.3455 94.5606 18.6339 96 18.6339C97.4395 18.6339 98.8648 18.3455 100.195 17.7853C101.525 17.225 102.733 16.4039 103.751 15.3687L115.652 3.26533C116.669 2.23014 117.878 1.40897 119.208 0.848725C120.538 0.288478 121.963 0.00012207 123.402 0.00012207C124.842 0.00012207 126.267 0.288478 127.597 0.848725C128.927 1.40897 130.135 2.23014 131.153 3.26533L148.534 20.9424Z',
  'M20.592 43.7574C21.6098 42.7222 22.8181 41.901 24.148 41.3408C25.4779 40.7805 26.9033 40.4922 28.3427 40.4922C29.7822 40.4922 31.2075 40.7805 32.5374 41.3408C33.8673 41.901 35.0756 42.7222 36.0935 43.7574L53.4748 61.4345C54.4926 62.4696 55.3001 63.6985 55.8509 65.051C56.4018 66.4035 56.6854 67.8531 56.6854 69.3171C56.6854 70.781 56.4018 72.2307 55.8509 73.5832C55.3001 74.9357 54.4926 76.1646 53.4748 77.1997L41.5739 89.3031C40.5561 90.3382 39.7486 91.5671 39.1978 92.9196C38.6469 94.2721 38.3633 95.7217 38.3633 97.1857C38.3633 98.6496 38.6469 100.099 39.1978 101.452C39.7486 102.804 40.5561 104.033 41.5739 105.068L53.4748 117.172C54.4926 118.207 55.3001 119.436 55.8509 120.788C56.4018 122.141 56.6854 123.59 56.6854 125.054C56.6854 126.518 56.4018 127.968 55.8509 129.32C55.3001 130.673 54.4926 131.902 53.4748 132.937L36.0935 150.614C35.0756 151.649 33.8673 152.47 32.5374 153.031C31.2075 153.591 29.7822 153.879 28.3427 153.879C26.9033 153.879 25.4779 153.591 24.148 153.031C22.8181 152.47 21.6098 151.649 20.592 150.614L3.21065 132.937C2.19278 131.902 1.38535 130.673 0.834474 129.32C0.2836 127.968 6.86646e-05 126.518 6.86646e-05 125.054C6.86646e-05 123.59 0.2836 122.141 0.834474 120.788C1.38535 119.436 2.19278 118.207 3.21065 117.172L15.1115 105.068C16.1294 104.033 16.9368 102.804 17.4877 101.452C18.0385 100.099 18.3221 98.6496 18.3221 97.1857C18.3221 95.7217 18.0385 94.2721 17.4877 92.9196C16.9368 91.5671 16.1294 90.3382 15.1115 89.3031L3.21065 77.1997C2.19278 76.1646 1.38535 74.9357 0.834474 73.5832C0.2836 72.2307 6.86646e-05 70.781 6.86646e-05 69.3171C6.86646e-05 67.8531 0.2836 66.4035 0.834474 65.051C1.38535 63.6985 2.19278 62.4696 3.21065 61.4345L20.592 43.7574Z',
  'M155.907 43.7574C156.924 42.7222 158.133 41.901 159.463 41.3408C160.792 40.7805 162.218 40.4922 163.657 40.4922C165.097 40.4922 166.522 40.7805 167.852 41.3408C169.182 41.901 170.39 42.7222 171.408 43.7574L188.789 61.4345C189.807 62.4696 190.615 63.6985 191.166 65.051C191.716 66.4035 192 67.8531 192 69.3171C192 70.781 191.716 72.2307 191.166 73.5832C190.615 74.9357 189.807 76.1646 188.789 77.1997L176.889 89.3031C175.871 90.3382 175.063 91.5671 174.512 92.9196C173.961 94.2721 173.678 95.7217 173.678 97.1857C173.678 98.6496 173.961 100.099 174.512 101.452C175.063 102.804 175.871 104.033 176.889 105.068L188.789 117.172C189.807 118.207 190.615 119.436 191.166 120.788C191.716 122.141 192 123.59 192 125.054C192 126.518 191.716 127.968 191.166 129.32C190.615 130.673 189.807 131.902 188.789 132.937L171.408 150.614C170.39 151.649 169.182 152.47 167.852 153.031C166.522 153.591 165.097 153.879 163.657 153.879C162.218 153.879 160.792 153.591 159.463 153.031C158.133 152.47 156.924 151.649 155.907 150.614L138.525 132.937C137.507 131.902 136.7 130.673 136.149 129.32C135.598 127.968 135.315 126.518 135.315 125.054C135.315 123.59 135.598 122.141 136.149 120.788C136.7 119.436 137.507 118.207 138.525 117.172L150.426 105.068C151.444 104.033 152.251 102.804 152.802 101.452C153.353 100.099 153.637 98.6496 153.637 97.1857C153.637 95.7217 153.353 94.2721 152.802 92.9196C152.251 91.5671 151.444 90.3382 150.426 89.3031L138.525 77.1997C137.507 76.1646 136.7 74.9357 136.149 73.5832C135.598 72.2307 135.315 70.781 135.315 69.3171C135.315 67.8531 135.598 66.4035 136.149 65.051C136.7 63.6985 137.507 62.4696 138.525 61.4345L155.907 43.7574Z',
  'M88.2492 68.8773C89.2671 67.8421 90.4754 67.0209 91.8053 66.4607C93.1352 65.9004 94.5605 65.6121 96 65.6121C97.4394 65.6121 98.8648 65.9004 100.195 66.4607C101.525 67.0209 102.733 67.8421 103.751 68.8773L121.132 86.5553C123.187 88.6458 124.342 91.4811 124.342 94.4374C124.342 97.3938 123.187 100.229 121.132 102.32L109.231 114.424C107.176 116.514 106.021 119.35 106.021 122.306C106.021 125.262 107.176 128.098 109.231 130.188L121.132 142.292C123.187 144.383 124.342 147.218 124.342 150.175C124.342 153.131 123.187 155.966 121.132 158.057L103.751 175.735C102.733 176.77 101.525 177.591 100.195 178.151C98.8648 178.712 97.4394 179 96 179C94.5605 179 93.1352 178.712 91.8053 178.151C90.4754 177.591 89.2671 176.77 88.2492 175.735L70.8679 158.057C68.8125 155.966 67.6578 153.131 67.6578 150.175C67.6578 147.218 68.8125 144.383 70.8679 142.292L82.7688 130.188C84.8242 128.098 85.9789 125.262 85.9789 122.306C85.9789 119.35 84.8242 116.514 82.7688 114.424L70.8679 102.32C68.8125 100.229 67.6578 97.3938 67.6578 94.4374C67.6578 91.4811 68.8125 88.6458 70.8679 86.5553L88.2492 68.8773Z',
];
