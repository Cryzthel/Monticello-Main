import 'package:flutter/material.dart';

import 'package:monticello_villas_app/app/auth_gate.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/theme/theme_mode_controller.dart';
import 'package:monticello_villas_app/core/widgets/click_spark_wrapper.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:monticello_villas_app/features/announcements/screens/announcements_screen.dart';
import 'package:monticello_villas_app/features/auth/screens/change_password_screen.dart';
import 'package:monticello_villas_app/features/auth/screens/forgot_password_screen.dart';
import 'package:monticello_villas_app/features/auth/screens/login_screen.dart';
import 'package:monticello_villas_app/features/auth/screens/sign_up_screen.dart';
import 'package:monticello_villas_app/features/auth/widgets/account_verification_gate.dart';
import 'package:monticello_villas_app/features/home/screens/home_screen.dart';
import 'package:monticello_villas_app/features/incidents/screens/report_incident_screen.dart';
import 'package:monticello_villas_app/features/notifications/screens/notifications_screen.dart';
import 'package:monticello_villas_app/features/panic_button/screens/panic_button_screen.dart';
import 'package:monticello_villas_app/features/profile/screens/edit_profile_screen.dart';
import 'package:monticello_villas_app/features/property/screens/property_details_screen.dart';

class MonticelloVillasApp extends StatelessWidget {
  const MonticelloVillasApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: ThemeModeController.instance,
      builder: (context, _) {
        return MaterialApp(
          title: 'Monticello Villas',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.lightTheme,
          darkTheme: AppTheme.lightTheme,
          themeMode: ThemeMode.light,
          builder: (context, navigator) {
            return ClickSparkWrapper(
              sparkColor: AppColors.accentPrimary,
              child: navigator!,
            );
          },
          // Any screen, dialog or sheet coming or going drops text focus, so a
          // keyboard opened on one route never sits over the next.
          navigatorObservers: [KeyboardDismissingObserver()],
          initialRoute: '/',
          // A name nothing registers lands on the auth gate, which routes to
          // whatever the signed-in state calls for, instead of throwing a red
          // "Could not find a generator for route" screen.
          onUnknownRoute: (_) =>
              MaterialPageRoute(builder: (_) => const AuthGate()),
          // ── ONLY ROUTES SOMETHING PUSHES ─────────────────────────────────
          // Removed 2026-10-17: '/splash' (AuthGate is the first screen),
          // '/onboarding' (AuthGate shows it inline), '/settings' (a second
          // Settings screen residents never see — the bottom-nav tab in
          // home_screen.dart is the real one), '/map' and '/incidents' (the
          // map is the dashboard backdrop and incidents is a tab). None had a
          // caller; each was a second way into a screen that already had one.
          routes: {
            // Root is now a REACTIVE gate, not a splash screen that imperatively
            // navigates away after a fixed delay. The tree is derived from auth
            // state, so there is no transition that can fail to fire and strand
            // the user on the previous screen. Every other named route below is
            // unchanged, so existing pushNamed calls keep working.
            '/': (_) => const AuthGate(),
            '/login': (_) => const LoginScreen(),
            '/register': (_) => const SignUpScreen(),
            '/forgot-password': (_) => const ForgotPasswordScreen(),
            // '/verify' was here. The self-serve "Verify Your Property" wizard
            // is gone — the HOA office verifies the address given at sign-up,
            // on the admin dashboard. Nothing in the app links here any more;
            // the route is removed rather than left as a dead name a future
            // pushNamed could resurrect.
            '/property-details': (_) => const PropertyDetailsScreen(),
            // Surfaces a resident may only use once the HOA office has
            // verified their account. Gating the report/panic routes too (not
            // just /home) means a deep link or a stale navigator stack can't
            // be used to file a report from an unverified account.
            '/home': (_) =>
                const AccountVerificationGate(child: HomeScreen()),
            // NOT wrapped in AccountVerificationGate, deliberately.
            //
            // The gate opens a fresh Firestore listener when it mounts and
            // renders a holding screen until the first snapshot arrives. And
            // `snapshots()` does not error when it cannot reach the server — it
            // waits. So a gated route could not satisfy "tapping Report shows
            // the workspace immediately": on a slow or unreachable connection
            // it showed a near-empty gradient screen indefinitely, which is the
            // blank-container report.
            //
            // Verification is now enforced at SUBMIT time instead (see
            // _ReportIncidentScreenState._submit), which is the correct layer
            // anyway: filing is the privileged action, not looking at the form.
            // firestore.rules remains the actual authority — the client check
            // is a courtesy message, not the security boundary.
            '/report': (_) => const ReportIncidentScreen(),
            '/panic': (_) =>
                const AccountVerificationGate(child: PanicButtonScreen()),
            '/change-password': (_) => const ChangePasswordScreen(),
            '/edit-profile': (_) => const EditProfileScreen(),
            // Two routes, two screens, two bodies of content. `/notifications`
            // used to be `AnnouncementsScreen(title: 'Notification')` — the same
            // community feed relabelled — so the bell rang for pool maintenance
            // notices while a resident's own report moved Pending → Dispatched
            // in silence. See the class doc on NotificationsScreen.
            '/announcements': (_) => const AnnouncementsScreen(),
            '/notifications': (_) => const NotificationsScreen(),
          },
        );
      },
    );
  }
}
