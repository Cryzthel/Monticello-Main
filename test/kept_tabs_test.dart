import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/widgets/kept_tabs.dart';

/// A tab with state worth losing: it counts its own builds-from-scratch.
class _Probe extends StatefulWidget {
  const _Probe(this.name);
  final String name;

  static final Map<String, int> mounts = {};

  @override
  State<_Probe> createState() => _ProbeState();
}

class _ProbeState extends State<_Probe> {
  int taps = 0;

  @override
  void initState() {
    super.initState();
    _Probe.mounts[widget.name] = (_Probe.mounts[widget.name] ?? 0) + 1;
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: TextButton(
        onPressed: () => setState(() => taps++),
        child: Text('${widget.name} $taps'),
      ),
    );
  }
}

void main() {
  setUp(_Probe.mounts.clear);

  Widget shell(int index) => MaterialApp(
        home: Scaffold(
          body: KeptTabs(
            index: index,
            children: const [_Probe('home'), _Probe('history'), _Probe('settings')],
          ),
        ),
      );

  testWidgets('a tab keeps its state across switches — it is never rebuilt',
      (tester) async {
    await tester.pumpWidget(shell(0));
    await tester.tap(find.text('home 0'));
    await tester.pump();
    expect(find.text('home 1'), findsOneWidget);

    await tester.pumpWidget(shell(1));
    await tester.pumpAndSettle();
    await tester.pumpWidget(shell(0));
    await tester.pumpAndSettle();

    // The tap survived the round trip, and Home was mounted exactly once.
    expect(find.text('home 1'), findsOneWidget);
    expect(_Probe.mounts['home'], 1);
  });

  testWidgets('a tab is not built until it is first opened', (tester) async {
    await tester.pumpWidget(shell(0));
    expect(_Probe.mounts.containsKey('settings'), isFalse);

    await tester.pumpWidget(shell(2));
    await tester.pumpAndSettle();
    expect(_Probe.mounts['settings'], 1);

    // Opening the middle tab later must not disturb the others' state.
    await tester.pumpWidget(shell(1));
    await tester.pumpAndSettle();
    await tester.pumpWidget(shell(2));
    await tester.pumpAndSettle();
    expect(_Probe.mounts, {'home': 1, 'settings': 1, 'history': 1});
  });

  testWidgets('a tab that is not showing is offstage and its tickers are off',
      (tester) async {
    await tester.pumpWidget(shell(0));
    await tester.pumpWidget(shell(1));
    await tester.pumpAndSettle();

    // Hidden from hit-testing and paint: only the active tab is onstage.
    expect(find.text('home 0'), findsNothing);
    expect(find.text('home 0', skipOffstage: false), findsOneWidget);
    expect(find.text('history 0'), findsOneWidget);

    final homeElement = tester.element(find.text('home 0', skipOffstage: false));
    expect(TickerMode.of(homeElement), isFalse);
    final historyElement = tester.element(find.text('history 0'));
    expect(TickerMode.of(historyElement), isTrue);
  });

  testWidgets('the incoming tab fades in, then settles fully opaque',
      (tester) async {
    await tester.pumpWidget(shell(0));
    await tester.pumpWidget(shell(1));
    await tester.pump(const Duration(milliseconds: 50));

    double opacityOf(String text) => tester
        .widget<FadeTransition>(find
            .ancestor(of: find.text(text), matching: find.byType(FadeTransition))
            .first)
        .opacity
        .value;

    expect(opacityOf('history 0'), inExclusiveRange(0.0, 1.0));
    await tester.pumpAndSettle();
    expect(opacityOf('history 0'), 1.0);
  });
}
