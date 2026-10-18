import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

import 'package:monticello_villas_app/core/firebase/firebase_options.dart';

bool firebaseAppReady = false;

Future<void> initializeFirebaseApp() async {
  try {
    if (Firebase.apps.isNotEmpty) {
      firebaseAppReady = true;
      return;
    }
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    firebaseAppReady = true;
  } on FirebaseException catch (e, st) {
    // Android applies google-services.json before Dart runs; a second init throws duplicate-app.
    if (e.code == 'duplicate-app') {
      firebaseAppReady = true;
      return;
    }
    debugPrint('Firebase init failed: $e\n$st');
    firebaseAppReady = false;
  } catch (e, st) {
    final msg = e.toString();
    if (msg.contains('duplicate-app')) {
      firebaseAppReady = true;
      return;
    }
    debugPrint('Firebase init failed (flutterfire configure / google-services.json): $e\n$st');
    firebaseAppReady = false;
  }
}
