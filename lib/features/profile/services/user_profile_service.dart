import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

class UserProfile {
  final String uid;
  final String name;
  final String email;
  final String phone;
  final String bio;
  final String photoUrl;
  final bool notificationsEnabled;
  final bool emailAlertsEnabled;
  final bool soundAlertsEnabled;
  final bool biometricLogin;

  const UserProfile({
    required this.uid,
    required this.name,
    required this.email,
    this.phone = '',
    this.bio = '',
    this.photoUrl = '',
    this.notificationsEnabled = true,
    this.emailAlertsEnabled = true,
    this.soundAlertsEnabled = true,
    this.biometricLogin = false,
  });

  UserProfile copyWith({
    String? name,
    String? email,
    String? phone,
    String? bio,
    String? photoUrl,
    bool? notificationsEnabled,
    bool? emailAlertsEnabled,
    bool? soundAlertsEnabled,
    bool? biometricLogin,
  }) {
    return UserProfile(
      uid: uid,
      name: name ?? this.name,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      bio: bio ?? this.bio,
      photoUrl: photoUrl ?? this.photoUrl,
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      emailAlertsEnabled: emailAlertsEnabled ?? this.emailAlertsEnabled,
      soundAlertsEnabled: soundAlertsEnabled ?? this.soundAlertsEnabled,
      biometricLogin: biometricLogin ?? this.biometricLogin,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'fullName': name,
      'name': name,
      'email': email,
      'phone': phone,
      'bio': bio,
      'photoUrl': photoUrl,
      'notificationsEnabled': notificationsEnabled,
      'emailAlertsEnabled': emailAlertsEnabled,
      'soundAlertsEnabled': soundAlertsEnabled,
      'biometricLogin': biometricLogin,
    };
  }

  factory UserProfile.fromFirestore(String uid, Map<String, dynamic> data) {
    return UserProfile(
      uid: uid,
      name: data['fullName'] ?? data['name'] ?? '',
      email: data['email'] ?? '',
      phone: data['phone'] ?? '',
      bio: data['bio'] ?? '',
      photoUrl: data['photoUrl'] ?? '',
      notificationsEnabled: data['notificationsEnabled'] ?? true,
      emailAlertsEnabled: data['emailAlertsEnabled'] ?? true,
      soundAlertsEnabled: data['soundAlertsEnabled'] ?? true,
      biometricLogin: data['biometricLogin'] ?? false,
    );
  }
}

class UserProfileService extends ChangeNotifier {
  UserProfileService._internal();
  static final UserProfileService instance = UserProfileService._internal();

  final _firestore = FirebaseFirestore.instance;

  UserProfile? _profile;
  UserProfile? get profile => _profile;

  bool _loading = false;
  bool get loading => _loading;

  /// Whether a [load] has run to completion at least once — including the
  /// signed-out and failed paths, which also settle this service.
  ///
  /// Distinct from `!loading`, and the distinction is what a skeleton needs:
  /// on the very first frame nothing has started yet, so `loading` is still
  /// false while [profile] is null. A placeholder keyed off `loading` alone
  /// would flash the "no profile" state before the fetch it is waiting for had
  /// even begun.
  bool get hasLoaded => _hasLoaded;
  bool _hasLoaded = false;


  // ── LIVE, NOT A ONE-SHOT READ ──────────────────────────────────────────────
  //
  // [load] is a single `get()`. That was defensible while the resident was the
  // only writer of their own `users/{uid}` document — but they are not, and the
  // gap became a real one the moment Edit Profile stopped letting them change
  // their name: the field now says the HOA office sets it, and the office
  // writes it from the admin portal. Under a one-shot read, a name corrected by
  // staff did not reach the handset until the app was killed and relaunched.
  //
  // The same applies to the photo and to every preference the portal can touch.
  // This service already extends [ChangeNotifier], so a snapshot listener makes
  // every `ListenableBuilder` on it live for free — the home header, Settings,
  // Edit Profile — with no call-site changes.
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _profileSub;

  /// Subscribes to this user's profile document. Idempotent: calling it again
  /// for the same user replaces the subscription rather than stacking a second
  /// one, so a re-entrant session warm-up cannot double-notify every listener.
  void startListening() {
    final user = FirebaseAuth.instance.currentUser;
    _profileSub?.cancel();
    _profileSub = null;
    if (user == null) return;

    _profileSub = _firestore
        .collection('users')
        .doc(user.uid)
        .snapshots()
        .listen((doc) {
      if (!doc.exists || doc.data() == null) return;
      _profile = UserProfile.fromFirestore(user.uid, doc.data()!);
      _hasLoaded = true;
      _loading = false;
      notifyListeners();
    }, onError: (_) {
      // Whatever [load] last resolved stays on screen. A listener that drops
      // must not blank a header that is already showing the right name.
    });
  }

  void stopListening() {
    _profileSub?.cancel();
    _profileSub = null;
  }

  Future<UserProfile?> load() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      _profile = null;
      _hasLoaded = true;
      notifyListeners();
      return null;
    }
    _loading = true;
    notifyListeners();

    final uid = user.uid;
    try {
      final doc = await _firestore.collection('users').doc(uid).get();
      if (doc.exists && doc.data() != null) {
        _profile = UserProfile.fromFirestore(uid, doc.data()!);
      } else {
        final fallbackName =
            (user.displayName != null && user.displayName!.trim().isNotEmpty)
                ? user.displayName!.trim()
                : (user.email?.split('@').first ?? 'Resident');
        _profile = UserProfile(
          uid: uid,
          name: fallbackName,
          email: user.email ?? '',
        );
        await _firestore
            .collection('users')
            .doc(uid)
            .set(_profile!.toFirestore());
      }
    } catch (_) {
      final fallbackName =
          (user.displayName != null && user.displayName!.trim().isNotEmpty)
              ? user.displayName!.trim()
              : (user.email?.split('@').first ?? 'Resident');
      _profile = UserProfile(
        uid: uid,
        name: fallbackName,
        email: user.email ?? '',
      );
    }

    _loading = false;
    _hasLoaded = true;
    notifyListeners();
    return _profile;
  }

  /// Writes the profile, then updates the in-memory copy.
  ///
  /// THROWS when the write is refused. It used to swallow the error and carry
  /// on, so Edit Profile toasted "Profile updated." over a write Firestore had
  /// rejected — and the in-memory profile then disagreed with the database
  /// until the next snapshot quietly put the old photo back.
  Future<void> save(UserProfile profile) async {
    await _firestore
        .collection('users')
        .doc(profile.uid)
        .set(profile.toFirestore(), SetOptions(merge: true));

    final user = FirebaseAuth.instance.currentUser;
    if (user != null && profile.name != (user.displayName ?? '')) {
      try {
        await user.updateDisplayName(profile.name);
      } catch (_) {}
    }

    _profile = profile;
    notifyListeners();
  }

  Future<void> updateField({
    String? name,
    String? phone,
    String? bio,
    bool? notificationsEnabled,
    bool? emailAlertsEnabled,
    bool? soundAlertsEnabled,
    bool? biometricLogin,
  }) async {
    final current = _profile;
    if (current == null) return;
    final updated = current.copyWith(
      name: name,
      phone: phone,
      bio: bio,
      notificationsEnabled: notificationsEnabled,
      emailAlertsEnabled: emailAlertsEnabled,
      soundAlertsEnabled: soundAlertsEnabled,
      biometricLogin: biometricLogin,
    );
    await save(updated);
  }

  void clear() {
    // Detach FIRST. The listener is scoped to the signed-out user's document
    // and, left running, would deliver one more snapshot after this and put
    // their name straight back — see [LocalDataStore.clear], which is the same
    // choke point for the same reason.
    stopListening();
    _profile = null;
    // Sign-out returns this service to first-run state, so the next resident's
    // Settings screen shows its skeleton while their profile is fetched rather
    // than the empty shell of an account that is no longer signed in.
    _hasLoaded = false;
    notifyListeners();
  }
}
