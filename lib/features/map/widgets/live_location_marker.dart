import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// A painted marker, plus where its point actually is.
///
/// The tip travels WITH the bytes so no caller ever hardcodes it. It is always
/// the bitmap's exact centre — see [LiveLocationMarker.paint] for why — but it
/// is still reported rather than assumed, and the tests pin that it is.
class LiveLocationMarkerImage {
  const LiveLocationMarkerImage({
    required this.bytes,
    required this.width,
    required this.height,
    required this.tip,
  });

  /// PNG bytes, painted at [LiveLocationMarker.paint]'s `pixelRatio`.
  final Uint8List bytes;

  /// Bitmap size in device pixels.
  final double width;
  final double height;

  /// The stem's point, in device pixels from the bitmap's top-left. This is
  /// the pixel that lands on the resident's coordinate.
  final ui.Offset tip;
}

/// Paints the Life360-style "you are here" pin to PNG bytes.
///
/// ── ONE MARKER, DRAWN BY THE NATIVE PUCK ──────────────────────────────────
/// These bytes become the `topImage` of Mapbox's own location puck. They used
/// to be a separate PointAnnotation fed from geolocator while the native puck
/// drew its stock blue dot from Mapbox's own location provider — two layers,
/// two position sources, and on a real phone two markers 15–20 m apart. Now
/// the puck IS the pin: one engine, glided between real fixes by the native
/// renderer, with its accuracy ring sized in metres and its heading cone
/// ([paintHeadingCone]) turned by the compass.
///
/// ── WHY THE TIP IS THE BITMAP'S CENTRE ────────────────────────────────────
/// A puck image is drawn centred on the coordinate, with no offset option. So
/// the figure is laid out with the stem's point at the exact middle of the
/// bitmap and the bottom half left transparent.
///
/// ── THE FIGURE ────────────────────────────────────────────────────────────
/// A round portrait (or initials on the accent) in a crisp 2pt white border,
/// a small white stem whose point is the coordinate, and a shadow-lg under
/// both. No label of any kind beside it — the duration badge is gone.
///
/// Rasterised at the device pixel ratio, so the portrait is sharp over
/// satellite tiles rather than an upscaled thumbnail.
class LiveLocationMarker {
  LiveLocationMarker._();

  /// Violet-600, per the reference marker: the plate behind the initials, the
  /// heading cone and the accuracy ring. Deliberately not the app's emerald —
  /// the resident and the subdivision boundary drawn around them are
  /// different facts.
  ///
  /// NAMED `ring` FOR AN OLD JOB (it framed the portrait before the frame went
  /// white). The name is the stale part, not the value.
  static const Color ring = Color(0xFF7C3AED); // violet-600

  // ── Layout ────────────────────────────────────────────────────────────────
  //
  // LOGICAL PIXELS AS DRAWN ON SCREEN. The bitmap is rasterised at
  // `pixelRatio` and Mapbox decodes puck images at the screen's scale, so
  // what is written here is what a resident sees.

  /// Outer diameter of the avatar disc, border included.
  static const double avatarDiameter = 52;

  /// The white border and the stem.
  static const Color shell = AppColors.onAccent;

  /// The white border's thickness — 2pt, per the brief.
  static const double borderWidth = 2;

  /// The stem below the disc. Its point is the coordinate.
  static const double stemHeight = avatarDiameter * 0.19;
  static const double _stemWidth = avatarDiameter * 0.30;

  /// How far the stem's base is tucked up under the disc, so the join has no
  /// notch either side.
  static const double _stemOverlap = avatarDiameter * 0.08;

  /// Tailwind's `shadow-lg`, scaled to a 52pt object and darkened for
  /// satellite imagery: a wide soft layer and a tight contact layer, each
  /// pulled in a little (Tailwind's negative spread) and dropped down-only.
  static const double _shadowWideDrop = 6;
  static const double _shadowWideBlur = 4.5; // sigma, pt
  static const double _shadowTightDrop = 2;
  static const double _shadowTightBlur = 1.75; // sigma, pt

  /// Room around the figure for the shadow to fall into: the wide layer's
  /// drop plus three sigmas, so the blur fades to nothing INSIDE the bitmap
  /// rather than being sliced flat at its edge.
  static const double shadowPad = _shadowWideDrop + _shadowWideBlur * 3 + 1;

  /// Radius of the heading cone, from the coordinate to its faded edge.
  static const double coneRadius = avatarDiameter * 1.6;

  /// Half the cone's opening angle — 64° in all, a beam rather than a slice.
  static const double coneHalfAngleDegrees = 32;

  /// Resolves the resident's profile photograph to a decoded image, or null.
  ///
  /// ── WHY THIS GOES THROUGH FLUTTER'S IMAGE CACHE ───────────────────────────
  /// The marker is repainted whenever the resident moves AND once a minute so
  /// the dwell label stays current. Fetching and decoding a portrait on every
  /// one of those would be a network round trip per minute for a picture that
  /// never changes. [NetworkImage] resolves through Flutter's own
  /// [imageCache], so the first call pays for the fetch and every later one is
  /// a cache hit — no second caching layer to keep coherent.
  ///
  /// Null is a normal answer and the common one: most residents have no photo.
  /// It is also what a failed fetch returns, because the two want the same
  /// treatment — draw the initials, which is a complete design in its own
  /// right rather than a degraded state.
  ///
  /// The returned image is owned by the cache. Callers must NOT dispose it.
  static Future<ui.Image?> resolvePhoto(String? url) {
    if (url == null || url.trim().isEmpty) return Future.value(null);

    final completer = Completer<ui.Image?>();
    final stream = NetworkImage(url).resolve(ImageConfiguration.empty);
    late final ImageStreamListener listener;

    void finish(ui.Image? image) {
      if (!completer.isCompleted) completer.complete(image);
      stream.removeListener(listener);
    }

    listener = ImageStreamListener(
      (info, _) => finish(info.image),
      onError: (_, __) => finish(null),
    );
    stream.addListener(listener);

    // A marker that never paints because one portrait is wedged is worse than
    // a marker wearing initials. The listener is removed either way.
    return completer.future.timeout(
      const Duration(seconds: 6),
      onTimeout: () {
        stream.removeListener(listener);
        return null;
      },
    );
  }

  /// The largest centred square of [image] — the crop a circular avatar wants.
  ///
  /// Drawing the whole source into a circle would squash a portrait to fit;
  /// taking the centre square and letting the clip do the rounding is the
  /// canvas equivalent of `object-fit: cover`.
  static Rect coverSquare(ui.Image image) {
    final w = image.width.toDouble();
    final h = image.height.toDouble();
    final side = math.min(w, h);
    return Rect.fromLTWH((w - side) / 2, (h - side) / 2, side, side);
  }


  /// Renders the pin.
  ///
  /// [photo] fills the avatar disc when the resident has one — see
  /// [resolvePhoto]. [initials] is what fills it otherwise, and is still
  /// required rather than optional: a photo can fail to load at any point, and
  /// the caller must always have supplied the thing that stands in for it.
  ///
  /// The returned bitmap is laid out so the stem's point is its exact centre;
  /// [LiveLocationMarkerImage.tip] reports it.
  static Future<LiveLocationMarkerImage> paint({
    required String initials,
    ui.Image? photo,
    double pixelRatio = 3.0,
  }) async {
    final r = pixelRatio;

    // ── Geometry, with the disc's centre at the origin ──────────────────────
    final radius = avatarDiameter / 2 * r;
    final tipY = radius + stemHeight * r;
    final pad = shadowPad * r;

    // Centre the bitmap on the stem's point (x = 0, y = tipY). Rounded up to
    // whole pixels so the encoded image's centre IS the point, not half a
    // pixel off it.
    //
    // ── SQUARE, ALWAYS ──────────────────────────────────────────────────────
    // Mapbox's location indicator draws its top image into a SQUARE. This was
    // a tall rectangle (the pin above the centre, padding below), and on a
    // real phone the indicator squeezed it to fit: the round portrait came out
    // as a wide ellipse. The longer half sets both sides now, and the extra
    // width is just transparent padding.
    final half =
        math.max(radius + pad, tipY + radius + pad).ceilToDouble();
    final halfW = half;
    final halfH = half;
    final tip = Offset(halfW, halfH);

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..translate(halfW, halfH - tipY);

    // ── Stem, disc, and one shadow under both ───────────────────────────────
    final stemTop = radius - _stemOverlap * r;
    final stemHalf = _stemWidth / 2 * r;
    // Curved sides, so it reads as the tail of a speech bubble rather than a
    // triangle stuck to a circle.
    final stem = Path()
      ..moveTo(-stemHalf, stemTop)
      ..quadraticBezierTo(-stemHalf * 0.18, tipY - stemHeight * r * 0.30, 0, tipY)
      ..quadraticBezierTo(stemHalf * 0.18, tipY - stemHeight * r * 0.30,
          stemHalf, stemTop)
      ..close();
    final disc = Path()
      ..addOval(Rect.fromCircle(center: Offset.zero, radius: radius));
    final body = Path.combine(PathOperation.union, disc, stem);

    // From the combined outline: two overlapping shadows darken where they
    // cross and leave a seam exactly where the stem meets the disc. Each layer
    // is scaled in a touch about the disc centre — the negative spread.
    for (final (drop, sigma, alpha) in [
      (_shadowWideDrop, _shadowWideBlur, 0x38),
      (_shadowTightDrop, _shadowTightBlur, 0x30),
    ]) {
      final inset = Matrix4.diagonal3Values(0.94, 0.94, 1);
      canvas.drawPath(
        body.transform(inset.storage).shift(Offset(0, drop * r)),
        Paint()
          ..color = Color.fromARGB(alpha, 0, 0, 0)
          ..maskFilter = ui.MaskFilter.blur(ui.BlurStyle.normal, sigma * r),
      );
    }
    canvas.drawPath(body, Paint()..color = shell);

    // ── The plate inside the border ─────────────────────────────────────────
    //
    // WHITE under a photograph — a portrait with transparency would otherwise
    // show the border through it — and the ACCENT behind initials, which need
    // a field to sit on.
    final border = borderWidth * r;
    final plateR = radius - border;
    // The photo is clipped a hair LARGER than the plate and the border is
    // stroked over its edge afterwards. Clipping exactly to the plate leaves
    // an anti-aliased fringe where the photo's edge and the ring's inner edge
    // each fade to half-cover — a faint hairline gap. Overlapping, then
    // covering with the border, leaves one crisp edge.
    final photoRect =
        Rect.fromCircle(center: Offset.zero, radius: plateR + border / 2);
    canvas.drawCircle(
      Offset.zero,
      plateR + border / 2,
      Paint()..color = photo == null ? ring : AppColors.backgroundSecondary,
    );

    if (photo != null) {
      canvas.save();
      canvas.clipPath(Path()..addOval(photoRect));
      canvas.drawImageRect(
        photo,
        coverSquare(photo),
        photoRect,
        Paint()
          ..filterQuality = FilterQuality.high
          ..isAntiAlias = true,
      );
      canvas.restore();
    } else {
      final initialsPainter = _text(
        initials,
        // Scales off the plate, not the outer diameter, so two initials clear
        // the border at every avatar size.
        (avatarDiameter - borderWidth * 2) * 0.38,
        FontWeight.w800,
        shell,
        r,
      );
      initialsPainter.paint(
        canvas,
        Offset(-initialsPainter.width / 2, -initialsPainter.height / 2),
      );
    }

    // The border, centred on the band between the plate and the outer edge.
    canvas.drawCircle(
      Offset.zero,
      radius - border / 2,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = border
        ..isAntiAlias = true
        ..color = shell,
    );

    return _encode(recorder, halfW * 2, halfH * 2, tip);
  }

  /// The heading beam, as the puck's `bearingImage`.
  ///
  /// Square, with the cone's apex at the exact centre pointing straight up
  /// (north). Mapbox draws the bearing image centred on the coordinate and
  /// rotates it to the compass heading, so the beam fans out from the point
  /// the stem marks, under the pin, in whichever direction the phone faces.
  /// Strongest at the apex and gone by the rim, like the reference.
  static Future<Uint8List> paintHeadingCone({double pixelRatio = 3.0}) async {
    final r = pixelRatio;
    final radius = coneRadius * r;
    final side = (radius * 2).ceilToDouble();
    final centre = Offset(side / 2, side / 2);
    final half = coneHalfAngleDegrees * math.pi / 180;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final beam = Path()
      ..moveTo(centre.dx, centre.dy)
      ..arcTo(
        Rect.fromCircle(center: centre, radius: radius),
        -math.pi / 2 - half,
        half * 2,
        false,
      )
      ..close();
    canvas.drawPath(
      beam,
      Paint()
        ..shader = ui.Gradient.radial(
          centre,
          radius,
          [ring.withValues(alpha: 0.55), ring.withValues(alpha: 0.0)],
          [0.0, 1.0],
        ),
    );

    final image =
        await recorder.endRecording().toImage(side.toInt(), side.toInt());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    return data!.buffer.asUint8List();
  }

  /// Closes the recording and hands back PNG bytes plus the anchor.
  ///
  /// Extracted because the pill-less marker returns early — two exits into one
  /// encode, so the two cannot drift apart on how the bitmap is finished.
  static Future<LiveLocationMarkerImage> _encode(
    ui.PictureRecorder recorder,
    double width,
    double height,
    Offset tip,
  ) async {
    final image =
        await recorder.endRecording().toImage(width.ceil(), height.ceil());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();

    return LiveLocationMarkerImage(
      bytes: data!.buffer.asUint8List(),
      width: width,
      height: height,
      tip: tip,
    );
  }

  static TextPainter _text(
    String value,
    double size,
    FontWeight weight,
    Color color,
    double pixelRatio,
  ) {
    // sfPro() is deliberately NOT used: it may resolve to a Google font that
    // has not been fetched, and an unresolved family rasterises to nothing. A
    // bitmap baked with invisible text cannot be recovered from at runtime.
    final painter = TextPainter(
      text: TextSpan(
        text: value,
        style: TextStyle(
          fontSize: size * pixelRatio,
          fontWeight: weight,
          color: color,
          height: 1.25,
          fontFamilyFallback: kFontFallbacks,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    return painter;
  }

  /// Two letters for the avatar plate.
  ///
  /// ── TWO, NOT "ONE OR TWO" ─────────────────────────────────────────────────
  /// First and last initial when there is a surname on file — "LJ" identifies a
  /// person where "L" identifies a letter. A resident with only one name on
  /// file used to get that single letter, which is the case this now covers:
  /// the first TWO letters of the name instead, so "Lian" reads "LI".
  ///
  /// The plate is a fixed circle and the type scales off its diameter, so a
  /// two-letter monogram is what the avatar was measured for; a lone letter
  /// floated in the middle of it looking like a placeholder rather than a name.
  ///
  /// A genuinely one-character name still yields one character — there is no
  /// second letter to take, and padding it would invent one.
  static String initialsFor(String? fullName) {
    final parts = (fullName ?? '')
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return 'ME';
    if (parts.length == 1) {
      final only = parts.first;
      return (only.length == 1 ? only : only.substring(0, 2)).toUpperCase();
    }
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}
