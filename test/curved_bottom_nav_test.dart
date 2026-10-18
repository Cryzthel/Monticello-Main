import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/curved_bottom_nav.dart';

/// Records which destination was hit, so selection and dispatch can be
/// asserted separately — a tab that highlights but navigates nowhere and a tab
/// that navigates but never highlights are different bugs.
class _Taps {
  final List<String> hits = [];
  int sos = 0;
}

/// The four labels the dashboard ships, in bar order — two either side of the
/// notch. Contact and Alerts were removed from the bar; both destinations are
/// still reachable (Settings › Contact HOA office, and the header bell).
const List<String> _labels = [
  'Home',
  'Reports',
  'History',
  'Settings',
];

/// One filled glyph per tab, in bar order.
///
/// There is no idle/active pair any more. The Soft Modernism icon system is
/// solid everywhere and distinguishes selection by COLOUR — emerald when
/// active, muted slate when not — so an outline variant would be the one
/// non-conforming glyph in the app.
const List<IconData> _icons = [
  PhosphorIconsFill.house,
  PhosphorIconsFill.clipboardText,
  PhosphorIconsFill.receipt,
  PhosphorIconsFill.gearSix,
];

Widget _host(
  _Taps taps, {
  int selected = 0,
  EdgeInsets viewPadding = EdgeInsets.zero,
  List<String> labels = _labels,
}) {
  final items = [
    for (var i = 0; i < labels.length; i++)
      CurvedNavItem(
        icon: _icons[i],
        label: labels[i],
        selected: selected == i,
        onTap: () => taps.hits.add(labels[i]),
      ),
  ];

  return MaterialApp(
    home: MediaQuery(
      data: MediaQueryData(viewPadding: viewPadding, padding: viewPadding),
      child: Scaffold(
        body: Column(
          children: [
            const Expanded(child: ColoredBox(color: Color(0xFF0B120F))),
            CurvedBottomNav(items: items, onSos: () => taps.sos++),
          ],
        ),
      ),
    ),
  );
}

// WHAT THESE TESTS CANNOT TELL YOU.
//
// `flutter_test` substitutes a fixed-width test font where every glyph is one
// em wide; real Urbanist averages roughly half that. So any assertion of the
// form "this label fits" would be measuring the harness, not the app — under
// the test font even "Contact" overflows its slot, and a clipped label reports
// its size as the slot width, which makes label-to-label width comparisons
// meaningless too.
//
// So nothing below claims a label fits on a real device. What is asserted is
// font-independent: the geometry each label is given, that the bar lays out
// without overflowing, and that every tab dispatches where it should.
// How the labels actually read at 11pt still needs eyes on a real phone.

void main() {
  testWidgets('lays out all four labelled tabs around the SOS button',
      (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    expect(tester.takeException(), isNull);
    for (final label in _labels) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('SOS'), findsOneWidget);
  });

  testWidgets('four tabs lay out on a narrow phone without overflowing',
      (tester) async {
    // 360dp is the narrow end of Android in the field (Galaxy A-series and
    // most budget handsets) — the width at which a RenderFlex overflow would
    // show if the slots were over-subscribed.
    tester.view.physicalSize = const Size(360 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    expect(tester.takeException(), isNull);
    for (final label in _labels) {
      expect(find.text(label), findsOneWidget);
      // Every label stays on one line — the bar's height never grows to
      // accommodate a wrapped word.
      expect(tester.getSize(find.text(label)).height,
          lessThan(CurvedBottomNav.barHeight / 2));
    }
  });

  testWidgets('each tab gets its documented share of a 360dp bar',
      (tester) async {
    // The budget every label has to live inside, measured rather than assumed,
    // and independent of which font the harness substitutes.
    //
    // (360 - 2 x 43 notch) / 4 slots = 68.5dp of pitch, against 45.67 when the
    // bar carried six. Trimming Contact and Alerts bought every surviving
    // label half again as much room, which is what lets the typography go back
    // up to the roomier 11pt/22px scale. A change to the notch reservation or
    // the item count moves this and should fail here first.
    tester.view.physicalSize = const Size(360 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    final home = tester.getCenter(find.text('Home')).dx;
    final reports = tester.getCenter(find.text('Reports')).dx;
    expect(reports - home, closeTo(68.5, 0.5));

    // Same pitch on the far side of the notch — the split is genuinely even.
    final history = tester.getCenter(find.text('History')).dx;
    final settings = tester.getCenter(find.text('Settings')).dx;
    expect(settings - history, closeTo(68.5, 0.5));
  });

  testWidgets('the SOS button is centred and sits above the bar',
      (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    final nav = tester.getRect(find.byType(CurvedBottomNav));
    final sos = tester.getRect(find.text('SOS'));

    expect(sos.center.dx, closeTo(nav.center.dx, 1.0));
    // The button pops out of the bar rather than sitting inside it.
    expect(sos.top, lessThan(nav.bottom - CurvedBottomNav.barHeight));
  });

  testWidgets('two tabs sit either side of the notch, in order',
      (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    final xs = [for (final l in _labels) tester.getCenter(find.text(l)).dx];
    final centre = tester.getCenter(find.text('SOS')).dx;

    // Strictly increasing left to right…
    for (var i = 1; i < xs.length; i++) {
      expect(xs[i], greaterThan(xs[i - 1]), reason: 'tab order broke at $i');
    }
    // …with the split two/two about the button.
    expect(xs[1], lessThan(centre));
    expect(xs[2], greaterThan(centre));
  });

  testWidgets('each tab dispatches its own callback', (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    for (final label in _labels) {
      await tester.tap(find.text(label));
    }
    await tester.pump();

    expect(taps.hits, _labels);
    expect(taps.sos, 0, reason: 'no tab may fire the emergency trigger');
  });

  testWidgets('the SOS button dispatches the emergency action', (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps));

    await tester.tap(find.text('SOS'));
    await tester.pump();

    expect(taps.sos, 1);
    expect(taps.hits, isEmpty);
  });

  testWidgets('every glyph is filled — selection is carried by colour',
      (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps, selected: 0));

    Color colourOf(IconData icon) =>
        tester.widget<Icon>(find.byIcon(icon)).color!;

    // All four solid glyphs are present…
    for (final icon in _icons) {
      expect(find.byIcon(icon), findsOneWidget);
    }
    // …the selected one in vibrant emerald…
    expect(colourOf(_icons[0]), AppColors.accentPrimary);
    // …and the rest in muted slate, still filled.
    for (final icon in _icons.skip(1)) {
      expect(colourOf(icon), AppColors.textMuted);
    }
  });

  testWidgets('selection moves with the index', (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps, selected: 3));

    Color colourOf(IconData icon) =>
        tester.widget<Icon>(find.byIcon(icon)).color!;

    expect(colourOf(_icons[3]), AppColors.accentPrimary);
    expect(colourOf(_icons[0]), AppColors.textMuted);
  });

  testWidgets('an odd item count is rejected rather than laid out lopsided',
      (tester) async {
    final taps = _Taps();
    await tester.pumpWidget(_host(taps, labels: const ['Home', 'Reports', 'History']));

    // The assert fires during build and cascades into follow-on layout errors,
    // so the harness reports a summary rather than the AssertionError itself —
    // what matters is that an odd count is refused loudly instead of silently
    // rendering an off-centre bar.
    expect(tester.takeException(), isNotNull);
  });

  testWidgets('grows by the safe-area inset instead of overlapping it',
      (tester) async {
    final flat = _Taps();
    await tester.pumpWidget(_host(flat));
    final withoutInset = tester.getSize(find.byType(CurvedBottomNav)).height;

    final inset = _Taps();
    await tester.pumpWidget(
      _host(inset, viewPadding: const EdgeInsets.only(bottom: 34)),
    );
    final withInset = tester.getSize(find.byType(CurvedBottomNav)).height;

    // A gesture-bar device gets a taller bar, not labels sitting under the
    // home indicator.
    expect(withInset - withoutInset, 34);
  });
}
