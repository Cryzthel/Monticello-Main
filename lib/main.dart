import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_fonts/google_fonts.dart';

import 'screens/announcements_screen.dart';
import 'screens/change_password_screen.dart';
import 'screens/edit_profile_screen.dart';
import 'screens/forgot_password_screen.dart';
import 'screens/home_screen.dart';
import 'screens/incidents_screen.dart';
import 'screens/login_screen.dart';
import 'screens/map_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/panic_button_screen.dart';
import 'screens/property_details_screen.dart';
import 'screens/report_incident_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/sign_up_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/verify_property_screen.dart';
import 'services/firebase_bootstrap.dart';
import 'services/theme_mode_controller.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  GoogleFonts.config.allowRuntimeFetching = false;
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );

  await initializeFirebaseApp();
  final uid = FirebaseAuth.instance.currentUser?.uid;
  await ThemeModeController.instance.load(userId: uid);

  runApp(const MonticelloVillasApp());
}

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
          darkTheme: AppTheme.darkTheme,
          themeMode: ThemeModeController.instance.themeMode,
          initialRoute: '/',
          routes: {
            '/': (_) => const SplashScreen(),
            '/onboarding': (_) => const OnboardingScreen(),
            '/login': (_) => const LoginScreen(),
            '/register': (_) => const SignUpScreen(),
            '/forgot-password': (_) => const ForgotPasswordScreen(),
            '/verify': (_) => const VerifyPropertyScreen(),
            '/property-details': (_) => const PropertyDetailsScreen(),
            '/home': (_) => const HomeScreen(),
            '/settings': (_) => const SettingsScreen(),
            '/change-password': (_) => const ChangePasswordScreen(),
            '/edit-profile': (_) => const EditProfileScreen(),
            '/report': (_) => const ReportIncidentScreen(),
            '/announcements': (_) => const AnnouncementsScreen(),
            '/panic': (_) => const PanicButtonScreen(),
            '/map': (_) => const MapScreen(),
            '/incidents': (_) => const IncidentsScreen(),
          },
        );
      },
    );
  }
}
