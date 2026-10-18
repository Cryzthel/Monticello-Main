import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/bounded_map_widget.dart';

/// Proves the two properties the homepage layout now depends on.
///
/// The regression this guards against: a map placed directly in a scrolling
/// column receives an UNBOUNDED vertical constraint. Map widgets try to fill
/// that, the subtree collapses, and the dashboard renders as a background
/// colour with a squeezed box in the middle.
void main() {
  Widget host(Widget child) => MaterialApp(
        home: Scaffold(
          // A SingleChildScrollView + Column is the exact unbounded-height
          // context that breaks a naked map.
          body: SingleChildScrollView(
            child: Column(children: [child]),
          ),
        ),
      );

  testWidgets('pins a fixed height inside an unbounded parent', (tester) async {
    await tester.pumpWidget(
      host(
        const BoundedMapWidget(
          height: 230,
          child: SizedBox.expand(child: ColoredBox(color: Color(0xFF00FF00))),
        ),
      ),
    );

    // A greedy child (SizedBox.expand) inside an unbounded column would
    // normally throw or blow up the layout. Here it is clamped to exactly the
    // declared height.
    final size = tester.getSize(find.byType(BoundedMapWidget));
    expect(size.height, 230);
    expect(size.width, greaterThan(0));
    expect(tester.takeException(), isNull);
  });

  testWidgets('honours a different declared height', (tester) async {
    await tester.pumpWidget(
      host(const BoundedMapWidget(height: 120, child: SizedBox.expand())),
    );
    expect(tester.getSize(find.byType(BoundedMapWidget)).height, 120);
  });

  testWidgets('a throwing map degrades to a placeholder, not a dead screen',
      (tester) async {
    await tester.pumpWidget(
      host(
        const BoundedMapWidget(
          height: 200,
          placeholderLabel: 'Map unavailable',
          child: _ExplodingMap(),
        ),
      ),
    );

    // The failure is contained: the box keeps its height and the surrounding
    // dashboard would still render.
    expect(tester.getSize(find.byType(BoundedMapWidget)).height, 200);
    expect(find.text('Map unavailable'), findsOneWidget);

    // The child's exception is still reported to the framework — swallowing it
    // silently would hide a real bug — so drain it to keep the test green.
    expect(tester.takeException(), isNotNull);
  });
}

class _ExplodingMap extends StatelessWidget {
  const _ExplodingMap();

  @override
  Widget build(BuildContext context) => throw StateError('map failed to build');
}
