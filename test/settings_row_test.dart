import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/settings_row.dart';

/// Any decorated box inside the rows — the plates the glyphs used to sit on.
List<DecoratedBox> _plates(WidgetTester tester) => tester
    .widgetList<DecoratedBox>(find.descendant(
      of: find.byType(Column).first,
      matching: find.byType(DecoratedBox),
    ))
    .where((d) => d.decoration is BoxDecoration &&
        (d.decoration as BoxDecoration).color != null)
    .toList();

Color _glyph(WidgetTester tester, IconData icon) =>
    tester.widget<Icon>(find.byIcon(icon)).color!;

Future<void> _pumpList(WidgetTester tester) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Column(
          children: [
            SettingsRow(
              icon: AppIcons.property,
              label: 'Property details',
              onTap: () {},
            ),
            const SettingsRowDivider(),
            SettingsSwitchRow(
              icon: AppIcons.darkMode,
              label: 'Dark mode',
              value: false,
              onChanged: (_) {},
            ),
            const SettingsRowDivider(),
            SettingsRow(
              icon: AppIcons.signOut,
              label: 'Sign out',
              destructive: true,
              showChevron: false,
              onTap: () {},
            ),
          ],
        ),
      ),
    ),
  );
}

void main() {
  group('the settings icons', () {
    testWidgets('an ordinary row draws the accent glyph, with no plate',
        (tester) async {
      await _pumpList(tester);

      expect(_glyph(tester, AppIcons.property), SettingsIconTile.accent);
      // No row builds a decorated box any more: the green squares behind the
      // glyphs were removed so the icons stand on the row by themselves.
      expect(_plates(tester), isEmpty);
    });

    testWidgets('a switch row is painted identically to a nav row',
        (tester) async {
      await _pumpList(tester);

      // A toggle and a destination are the same rank.
      expect(_glyph(tester, AppIcons.darkMode), SettingsIconTile.accent);
    });

    testWidgets('the destructive row is red', (tester) async {
      await _pumpList(tester);

      // Sign out in brand emerald would be a destructive action wearing the
      // colour the app uses for "go ahead".
      expect(_glyph(tester, AppIcons.signOut), AppColors.danger);
    });

    testWidgets('labels line up: every glyph sits in the same slot',
        (tester) async {
      await _pumpList(tester);

      final lefts = [
        tester.getTopLeft(find.text('Property details')).dx,
        tester.getTopLeft(find.text('Dark mode')).dx,
        tester.getTopLeft(find.text('Sign out')).dx,
      ];
      expect(lefts.toSet(), hasLength(1));
      expect(lefts.first, SettingsRow.contentInset);
    });
  });
}
