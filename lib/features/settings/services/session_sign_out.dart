import 'package:firebase_auth/firebase_auth.dart';

import 'package:monticello_villas_app/core/notifications/push_registration.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';

/// Ends the resident's session and forgets everything cached for them.
///
/// ONE ROUTINE. Settings and the account-review screen each had their own
/// copy, and the review screen's skipped the profile and local-data caches —
/// so the next person to sign in on the handset briefly saw the previous
/// resident's name and address until their own profile loaded.
///
/// Callers pop back to the first route afterwards; AuthGate, listening to the
/// auth state, then shows the login screen.
Future<void> endResidentSession() async {
  AccountApprovalService.clearStatusCache();
  // BEFORE signOut, while there is still a uid to key the delete by. Leaving
  // the token behind would deliver this resident's next dispatch push — their
  // address, their incident — to whoever signs in next on this handset. Each
  // step inside is time-bounded, so a dead network cannot hold sign-out up.
  await PushRegistration.instance.clear();
  await FirebaseAuth.instance.signOut();
  LocalDataStore.instance.clear();
  UserProfileService.instance.clear();
}
