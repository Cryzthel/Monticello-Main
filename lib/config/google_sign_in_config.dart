/// OAuth 2.0 **Web client** ID from the same Google Cloud project as Firebase.
///
/// Needed on Android when using Firebase Auth + Google Sign-In so the ID token
/// matches what Firebase expects. Find it in:
/// **Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs**
/// → entry named like **Web client (auto created by Google Service)** —
/// the client ID ends with `.apps.googleusercontent.com`.
///
/// Optional: pass at build/run time without editing code:
/// `flutter run --dart-define=GOOGLE_WEB_CLIENT_ID=YOUR_ID.apps.googleusercontent.com`
const String kGoogleWebOAuthClientId = String.fromEnvironment(
  'GOOGLE_WEB_CLIENT_ID',
  defaultValue: '',
);
