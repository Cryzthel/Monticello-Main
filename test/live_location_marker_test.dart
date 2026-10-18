import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/map/widgets/live_location_marker.dart';

/// Guards the Life360 marker's ANCHORING CONTRACT.
///
/// The marker's whole job is to point at one coordinate. Which pixel of the
/// bitmap that is used to be a hardcoded number at the call site, copied by
/// hand from a constant in the painter — so resizing the avatar moved the point
/// without moving the number, and the marker would have gone on claiming the
/// resident was somewhere they were not. Nothing would have failed; it would
/// just have been wrong.
///
/// These tests assert the relationships that make the offset correct, not the
/// pixel values themselves. Hardcoding "tip.dx == 96" here would recreate the
/// original bug in the test file.
Future<LiveLocationMarkerImage> _paint({
  String initials = 'RR',
  ui.Image? photo,
  double ratio = 3.0,
}) =>
    LiveLocationMarker.paint(
      initials: initials,
      photo: photo,
      pixelRatio: ratio,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// RGBA of one pixel of a painted bitmap.
  Future<List<int>> pixel(Uint8List png, double x, double y) async {
    final image = await decodeImageFromList(png);
    final data = await image.toByteData();
    final i = (y.round() * image.width + x.round()) * 4;
    final rgba = [
      data!.getUint8(i),
      data.getUint8(i + 1),
      data.getUint8(i + 2),
      data.getUint8(i + 3),
    ];
    image.dispose();
    return rgba;
  }

  group('anchoring', () {
    test('the tip is the exact centre of the bitmap, at every ratio', () async {
      // The native puck draws its image CENTRED on the coordinate, with no
      // offset option, so the stem's point has to BE the centre. Anything off
      // it is a pin claiming the house next door.
      for (final ratio in [1.0, 2.0, 2.625, 3.0]) {
        final m = await _paint(ratio: ratio);
        expect(m.tip.dx, m.width / 2, reason: 'ratio $ratio');
        expect(m.tip.dy, m.height / 2, reason: 'ratio $ratio');
        // Whole pixels, so the decoded image's centre is the point and not
        // half a pixel beside it.
        expect(m.width, m.width.roundToDouble());
        expect(m.height, m.height.roundToDouble());
      }
    });

    test('the stem is drawn down to the tip, and nothing below it', () async {
      final m = await _paint(ratio: 2);
      final justAbove = await pixel(m.bytes, m.tip.dx, m.tip.dy - 3 * 2);
      final wellBelow =
          await pixel(m.bytes, m.tip.dx, m.tip.dy + m.height / 4);

      expect(justAbove[3], greaterThan(200), reason: 'white stem at the point');
      expect(wellBelow[3], 0, reason: 'the bottom half is padding only');
    });

    test('the disc sits directly above the tip, one stem-length up', () async {
      const r = 2.0;
      final m = await _paint(ratio: r);
      const lift =
          LiveLocationMarker.stemHeight + LiveLocationMarker.avatarDiameter / 2;
      // Above the initials, still inside the plate: the disc's vertical axis
      // runs straight up from the tip.
      final centre = await pixel(m.bytes, m.tip.dx,
          m.tip.dy - (lift + LiveLocationMarker.avatarDiameter / 2 * 0.75) * r);

      // The initials plate is the accent, opaque.
      expect(centre[3], 255);
      expect(centre[0], closeTo(LiveLocationMarker.ring.r * 255, 30));
      expect(centre[2], closeTo(LiveLocationMarker.ring.b * 255, 30));
    });

    test('the disc is round, not a squircle', () async {
      const r = 2.0;
      final m = await _paint(ratio: r);
      const radius = LiveLocationMarker.avatarDiameter / 2;
      const lift = LiveLocationMarker.stemHeight + radius;
      // On the diagonal of the disc's bounding square, just inside its
      // top-left corner — outside a circle, inside any rounded square.
      final corner = await pixel(m.bytes, m.tip.dx - radius * 0.9 * r,
          m.tip.dy - (lift + radius * 0.9) * r);
      expect(corner[3], lessThan(24));
    });

    test('the border is white and 2pt', () async {
      const r = 3.0;
      final m = await _paint(ratio: r);
      const radius = LiveLocationMarker.avatarDiameter / 2;
      const lift = LiveLocationMarker.stemHeight + radius;
      final cy = m.tip.dy - lift * r;
      // Inside the border (1pt in from the edge) is white; 3pt in is plate.
      final border = await pixel(m.bytes, m.tip.dx - (radius - 1) * r, cy);
      final plate = await pixel(m.bytes, m.tip.dx - (radius - 3) * r, cy);

      expect(LiveLocationMarker.borderWidth, 2);
      expect(border.take(3), everyElement(greaterThan(240)));
      expect(plate[1], lessThan(120), reason: 'violet, not white');
    });
  });

  group('bytes', () {
    test('decode as a real image at the reported size', () async {
      final m = await _paint();
      final codec = await ui.instantiateImageCodec(m.bytes);
      final frame = await codec.getNextFrame();

      expect(frame.image.width, m.width.ceil());
      expect(frame.image.height, m.height.ceil());
      frame.image.dispose();
    });
  });

  group('initialsFor', () {
    test('takes first and last initial when a surname is present', () {
      expect(LiveLocationMarker.initialsFor('Razel Roldan'), 'RR');
      expect(LiveLocationMarker.initialsFor('maria clara de los santos'), 'MS');
    });

    test('a single name gives its first TWO letters, not one', () {
      // The plate is a fixed circle and the type scales off its diameter, so
      // the avatar was measured for a two-letter monogram. A lone "R" floated
      // in the middle of it read as a placeholder rather than as a name.
      expect(LiveLocationMarker.initialsFor('Razel'), 'RA');
      expect(LiveLocationMarker.initialsFor('Lian'), 'LI');
      expect(LiveLocationMarker.initialsFor('  chloe  '), 'CH');
    });

    test('a one-character name is not padded into a second letter', () {
      // There is no second letter to take, and inventing one would put a
      // character on the marker that is not in the resident's name.
      expect(LiveLocationMarker.initialsFor('R'), 'R');
    });

    test('nothing on file falls back to ME', () {
      expect(LiveLocationMarker.initialsFor(''), 'ME');
      expect(LiveLocationMarker.initialsFor('   '), 'ME');
      expect(LiveLocationMarker.initialsFor(null), 'ME');
    });
  });

  group('the profile photograph', () {
    /// A solid image of a known aspect, so the crop can be checked by
    /// arithmetic rather than by looking at pixels.
    Future<ui.Image> swatch(int w, int h) async {
      final recorder = ui.PictureRecorder();
      Canvas(recorder).drawRect(
        Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()),
        Paint()..color = const Color(0xFF112233),
      );
      return recorder.endRecording().toImage(w, h);
    }

    test('coverSquare takes the largest CENTRED square, landscape', () async {
      final image = await swatch(400, 200);
      final src = LiveLocationMarker.coverSquare(image);

      // `object-fit: cover` on a circle: the short side sets the size and the
      // long side is trimmed equally at both ends. Drawing the whole source
      // instead would squash a face to fit the circle.
      expect(src.width, 200);
      expect(src.height, 200);
      expect(src.left, 100);
      expect(src.top, 0);
      image.dispose();
    });

    test('coverSquare trims the tall side on a portrait', () async {
      final image = await swatch(200, 500);
      final src = LiveLocationMarker.coverSquare(image);

      expect(src.width, 200);
      expect(src.height, 200);
      expect(src.left, 0);
      expect(src.top, 150);
      image.dispose();
    });

    test('an already-square source is used whole', () async {
      final image = await swatch(300, 300);
      final src = LiveLocationMarker.coverSquare(image);

      expect(src, const Rect.fromLTWH(0, 0, 300, 300));
      image.dispose();
    });

    test('a photo does not move the point the marker claims', () async {
      // THE POINT OF THIS TEST. The bitmap's geometry — and therefore the
      // anchor offset derived from it — must be identical whether the avatar
      // is a face or two letters. A photo that changed the tip would silently
      // start pointing at the wrong house.
      final image = await swatch(256, 256);
      final withInitials = await _paint();
      final withPhoto = await _paint(photo: image);

      expect(withPhoto.width, withInitials.width);
      expect(withPhoto.height, withInitials.height);
      expect(withPhoto.tip, withInitials.tip);
      image.dispose();
    });

    test('a photo actually changes what is drawn', () async {
      // The companion to the test above: same box, different pixels. Without
      // this, a paint() that ignored `photo` entirely would pass.
      final image = await swatch(256, 256);
      final withInitials = await _paint();
      final withPhoto = await _paint(photo: image);

      expect(withPhoto.bytes, isNot(equals(withInitials.bytes)));
      image.dispose();
    });

    test('no photo is the ordinary case, not a failure', () async {
      // Most residents never set one, and a failed fetch is treated the same
      // way — both fall through to the initials, which are a complete design
      // rather than a degraded state.
      expect(await LiveLocationMarker.resolvePhoto(null), isNull);
      expect(await LiveLocationMarker.resolvePhoto(''), isNull);
      expect(await LiveLocationMarker.resolvePhoto('   '), isNull);
    });
  });

  group('no badge, and a shadow that is never clipped', () {
    test('the bitmap is square at every ratio', () async {
      // Mapbox's location indicator draws its top image into a square. A tall
      // bitmap was squeezed to fit and the round portrait rendered as a wide
      // ellipse on a real phone.
      for (final r in [1.0, 2.0, 2.625, 3.0]) {
        final m = await _paint(ratio: r);
        expect(m.width, m.height, reason: 'ratio $r');
      }
    });

    test('the disc is round in the bitmap itself', () async {
      // Equal extents left/right and up/down from the disc centre: the white
      // edge is the same distance away in all four directions.
      const r = 3.0;
      final m = await _paint(ratio: r);
      const radius = LiveLocationMarker.avatarDiameter / 2;
      const lift = LiveLocationMarker.stemHeight + radius;
      final cx = m.tip.dx;
      final cy = m.tip.dy - lift * r;
      for (final (dx, dy) in [(-1, 0), (1, 0), (0, -1)]) {
        final inside = await pixel(m.bytes, cx + dx * (radius - 0.5) * r,
            cy + dy * (radius - 0.5) * r);
        final outside = await pixel(m.bytes, cx + dx * (radius + 2) * r,
            cy + dy * (radius + 2) * r);
        expect(inside[3], 255, reason: 'inside the edge at ($dx, $dy)');
        expect(outside[3], lessThan(160), reason: 'past the edge at ($dx, $dy)');
      }
    });

    test('every edge of the bitmap is fully transparent', () async {
      // If the blur reached the edge it would be sliced flat there — the
      // "cut out with scissors" look. shadowPad exists to prevent exactly
      // that, so the outermost pixels must carry nothing.
      final m = await _paint(ratio: 2);
      final image = await decodeImageFromList(m.bytes);
      final data = (await image.toByteData())!;
      int alphaAt(int x, int y) => data.getUint8((y * image.width + x) * 4 + 3);
      var maxEdge = 0;
      for (var x = 0; x < image.width; x++) {
        maxEdge = [maxEdge, alphaAt(x, 0), alphaAt(x, image.height - 1)]
            .reduce((a, b) => a > b ? a : b);
      }
      for (var y = 0; y < image.height; y++) {
        maxEdge = [maxEdge, alphaAt(0, y), alphaAt(image.width - 1, y)]
            .reduce((a, b) => a > b ? a : b);
      }
      image.dispose();
      expect(maxEdge, lessThanOrEqualTo(1));
    });

    test('a dark portrait still meets a solid white ring, with no gap',
        () async {
      // The photo is clipped slightly past the plate and the border stroked
      // over it. Sample right across the seam: every pixel is either the
      // white ring or the photo, never a lighter or translucent fringe.
      const r = 3.0;
      final recorder = ui.PictureRecorder();
      Canvas(recorder).drawRect(
        const Rect.fromLTWH(0, 0, 64, 64),
        Paint()..color = const Color(0xFF101010),
      );
      final photo = await recorder.endRecording().toImage(64, 64);
      final m = await _paint(ratio: r, photo: photo);
      photo.dispose();

      const radius = LiveLocationMarker.avatarDiameter / 2;
      const lift = LiveLocationMarker.stemHeight + radius;
      final cy = m.tip.dy - lift * r;
      final ring = await pixel(m.bytes, m.tip.dx - (radius - 1) * r, cy);
      final face = await pixel(m.bytes, m.tip.dx - (radius - 3.5) * r, cy);

      expect(ring.take(3), everyElement(greaterThan(240)));
      expect(face.take(3), everyElement(lessThan(40)));
      for (var d = 0.5; d <= 4; d += 0.25) {
        final px = await pixel(m.bytes, m.tip.dx - (radius - d) * r, cy);
        expect(px[3], 255, reason: '${d}pt in from the edge is opaque');
      }
    });
  });

  group('scale', () {
    test('the avatar is pin-sized', () {
      expect(LiveLocationMarker.avatarDiameter, inInclusiveRange(48, 56),
          reason: 'a super-app pin runs 48-56pt');
    });

    test('the whole figure scales with the pixel ratio', () async {
      // Stem, pill and type are fractions of the avatar, so doubling the ratio
      // doubles every part in step (to within the whole-pixel rounding).
      final low = await _paint(ratio: 1);
      final high = await _paint(ratio: 2);

      expect(high.width / low.width, closeTo(2, 0.04));
      expect(high.height / low.height, closeTo(2, 0.04));
    });
  });

  group('the heading cone', () {
    test('is square with its apex at the centre, pointing north', () async {
      const r = 2.0;
      final png = await LiveLocationMarker.paintHeadingCone(pixelRatio: r);
      final image = await decodeImageFromList(png);
      expect(image.width, image.height);
      final c = image.width / 2;
      const reach = LiveLocationMarker.coneRadius * r;
      image.dispose();

      final north = await pixel(png, c, c - reach * 0.3);
      final south = await pixel(png, c, c + reach * 0.3);
      final east = await pixel(png, c + reach * 0.3, c);

      // Mapbox rotates the image about its centre by the compass heading, so
      // the beam must start there and open upward only.
      expect(north[3], greaterThan(40));
      expect(south[3], 0);
      expect(east[3], 0);
    });

    test('fades out toward its rim', () async {
      const r = 2.0;
      final png = await LiveLocationMarker.paintHeadingCone(pixelRatio: r);
      final image = await decodeImageFromList(png);
      final c = image.width / 2;
      image.dispose();
      const reach = LiveLocationMarker.coneRadius * r;

      final near = await pixel(png, c, c - reach * 0.2);
      final far = await pixel(png, c, c - reach * 0.9);
      expect(near[3], greaterThan(far[3]));
    });
  });

  group('the shell', () {
    test('the border is white and the accent is violet', () {
      expect(LiveLocationMarker.shell, const Color(0xFFFFFFFF));
      expect(LiveLocationMarker.ring, const Color(0xFF7C3AED));
    });

    test('a portrait and a monogram differ in pixels, not in box', () async {
      final recorder = ui.PictureRecorder();
      Canvas(recorder).drawRect(
        const Rect.fromLTWH(0, 0, 64, 64),
        Paint()..color = const Color(0xFF112233),
      );
      final image = await recorder.endRecording().toImage(64, 64);

      final monogram = await _paint();
      final portrait = await _paint(photo: image);

      expect(portrait.bytes, isNot(equals(monogram.bytes)));
      expect(portrait.width, monogram.width);
      expect(portrait.height, monogram.height);
      expect(portrait.tip, monogram.tip);
      image.dispose();
    });
  });
}
