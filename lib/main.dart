import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'theme/app_theme.dart';
import 'screens/splash_screen.dart';
import 'screens/login_screen.dart';
import 'screens/verify_property_screen.dart';
import 'screens/home_screen.dart';
import 'screens/report_incident_screen.dart';
import 'screens/announcements_screen.dart';
import 'screens/panic_button_screen.dart';
import 'screens/map_screen.dart';
import 'screens/incidents_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const MonticelloVillasApp());
}

class MonticelloVillasApp extends StatelessWidget {
  const MonticelloVillasApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Monticello Villas',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.theme,
      initialRoute: '/',
      routes: {
        '/': (_) => const SplashScreen(),
        '/login': (_) => const LoginScreen(),
        '/verify': (_) => const VerifyPropertyScreen(),
        '/home': (_) => const HomeScreen(),
        '/report': (_) => const ReportIncidentScreen(),
        '/announcements': (_) => const AnnouncementsScreen(),
        '/panic': (_) => const PanicButtonScreen(),
        '/map': (_) => const MapScreen(),
        '/incidents': (_) => const IncidentsScreen(),
      },
    );
  }
}
