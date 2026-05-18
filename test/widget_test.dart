import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/screens/login_screen.dart';
import 'package:monticello_villas_app/theme/app_theme.dart';

void main() {
  testWidgets('Login screen builds', (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.theme,
        home: const LoginScreen(),
      ),
    );
    await tester.pump();
    expect(find.text('Welcome back'), findsOneWidget);
  });
}
