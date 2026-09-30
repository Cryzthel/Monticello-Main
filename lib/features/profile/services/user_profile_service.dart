import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class UserProfile {
  final String uid;
  final String name;
  final String email;
  final String phone;
  final String bio;
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
      notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
      emailAlertsEnabled: emailAlertsEnabled ?? this.emailAlertsEnabled,
      soundAlertsEnabled: soundAlertsEnabled ?? this.soundAlertsEnabled,
      biometricLogin: biometricLogin ?? this.biometricLogin,
    );
  }
}

class UserProfileService extends ChangeNotifier {
  UserProfileService._internal();
  static final UserProfileService instance = UserProfileService._internal();

  static const _prefix = 'mv_profile_';

  UserProfile? _profile;
  UserProfile? get profile => _profile;

  bool _loading = false;
  bool get loading => _loading;

  String _key(String uid, String suffix) => '$_prefix${uid}_$suffix';

  /// Loads the profile for the currently signed-in user. If no record
  /// exists yet, seeds it with values from FirebaseAuth.
  Future<UserProfile?> load() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      _profile = null;
      notifyListeners();
      return null;
    }
    _loading = true;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    final uid = user.uid;
    final fallbackName =
        (user.displayName != null && user.displayName!.trim().isNotEmpty)
            ? user.displayName!.trim()
            : (user.email?.split('@').first ?? 'Resident');
    _profile = UserProfile(
      uid: uid,
      name: prefs.getString(_key(uid, 'name')) ?? fallbackName,
      email: prefs.getString(_key(uid, 'email')) ?? (user.email ?? ''),
      phone: prefs.getString(_key(uid, 'phone')) ?? '',
      bio: prefs.getString(_key(uid, 'bio')) ?? '',
      notificationsEnabled: prefs.getBool(_key(uid, 'notif')) ?? true,
      emailAlertsEnabled: prefs.getBool(_key(uid, 'email_alerts')) ?? true,
      soundAlertsEnabled: prefs.getBool(_key(uid, 'sound')) ?? true,
      biometricLogin: prefs.getBool(_key(uid, 'biometric')) ?? false,
    );
    _loading = false;
    notifyListeners();
    return _profile;
  }

  Future<void> save(UserProfile profile) async {
    final prefs = await SharedPreferences.getInstance();
    final uid = profile.uid;
    await prefs.setString(_key(uid, 'name'), profile.name);
    await prefs.setString(_key(uid, 'email'), profile.email);
    await prefs.setString(_key(uid, 'phone'), profile.phone);
    await prefs.setString(_key(uid, 'bio'), profile.bio);
    await prefs.setBool(_key(uid, 'notif'), profile.notificationsEnabled);
    await prefs.setBool(_key(uid, 'email_alerts'), profile.emailAlertsEnabled);
    await prefs.setBool(_key(uid, 'sound'), profile.soundAlertsEnabled);
    await prefs.setBool(_key(uid, 'biometric'), profile.biometricLogin);

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
    _profile = null;
    notifyListeners();
  }
}
