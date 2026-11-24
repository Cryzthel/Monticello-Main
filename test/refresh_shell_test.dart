import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';

/// The shared pull-to-refresh fires on a downward pull at the top, and never
/// on an upward swipe — the bug where the bar opened as residents scrolled up.
void main() {
  late int refreshes;

  Future<void> pump(WidgetTester tester, {required int items}) async {
    refreshes = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: RefreshShell(
          onRefresh: () async => refreshes++,
          child: ListView.builder(
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: items,
            itemBuilder: (_, i) => SizedBox(height: 60, child: Text('row $i')),
          ),
        ),
      ),
    ));
  }

  Future<void> settle(WidgetTester tester) async {
    // The bar holds open for one full spin of its loader.
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
  }

  testWidgets('a deliberate pull down at the top refreshes once',
      (tester) async {
    await pump(tester, items: 3);
    await tester.drag(find.text('row 0'), const Offset(0, 320));
    await settle(tester);
    expect(refreshes, 1);
  });

  testWidgets('swiping UP on a short list never refreshes', (tester) async {
    // Short enough that the list sits at its top and bottom at once — the
    // case where an upward swipe used to end in a refresh.
    await pump(tester, items: 3);
    await tester.drag(find.text('row 0'), const Offset(0, -320));
    await settle(tester);
    expect(refreshes, 0);
  });

  testWidgets('swiping up through a long list never refreshes',
      (tester) async {
    await pump(tester, items: 60);
    await tester.drag(find.text('row 2'), const Offset(0, -400));
    await settle(tester);
    expect(refreshes, 0);
  });

  testWidgets('pull down, then flick UP before letting go: no refresh',
      (tester) async {
    // The real-device bug: the indicator arms on the pull, and the SDK starts
    // a refresh on the momentum of whatever scroll follows — including an
    // upward flick.
    await pump(tester, items: 3);
    final g = await tester.startGesture(tester.getCenter(find.text('row 0')));
    for (var i = 0; i < 12; i++) {
      await g.moveBy(const Offset(0, 25)); // pull down 300px: armed
      await tester.pump(const Duration(milliseconds: 16));
    }
    // A short, fast flick back UP — not far enough to drop the indicator
    // below its arm threshold, so the SDK alone would still refresh on
    // release.
    for (var i = 0; i < 2; i++) {
      await g.moveBy(const Offset(0, -25));
      await tester.pump(const Duration(milliseconds: 8));
    }
    await g.up();
    await settle(tester);
    expect(refreshes, 0);
  });

  testWidgets('pulling down from mid-list only scrolls back, no refresh',
      (tester) async {
    await pump(tester, items: 60);
    await tester.drag(find.text('row 2'), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, 200));
    await settle(tester);
    expect(refreshes, 0);
  });
}
