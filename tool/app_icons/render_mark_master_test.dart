// Renders a high-resolution master of the brand emblem for the icon pipeline.
//
// Run it like a test, because that is the only way to get Flutter's rasterizer
// without a device:
//
//   flutter test tool/app_icons/render_mark_master_test.dart
//
// It writes ONE file — a white emblem on transparency — which
// tool/app_icons/gen_app_icons.py then composes into every Android and iOS
// icon. Two stages rather than one so the shape is rasterized by the same
// engine that draws it in the app, while the compositing (background colour,
// rounded corners, safe-zone insets, alpha stripping) happens where that work
// is easy.
//
// Regenerate after any change to lib/core/brand/brand_mark.dart.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/brand/brand_mark.dart';

const double _masterHeight = 1024;
const String _out = 'tool/app_icons/build/mark_master.png';

void main() {
  testWidgets('render the emblem master', (tester) async {
    final key = GlobalKey();
    final width = BrandMark.widthFor(_masterHeight);

    tester.view.physicalSize = Size(width, _masterHeight);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: RepaintBoundary(
          key: key,
          child: const BrandMark(
            height: _masterHeight,
            color: Color(0xFFFFFFFF),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.runAsync(() async {
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 2);
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      final file = File(_out);
      file.parent.createSync(recursive: true);
      file.writeAsBytesSync(data!.buffer.asUint8List());
      // ignore: avoid_print
      print('wrote $_out (${image.width}x${image.height})');
    });
  });
}
