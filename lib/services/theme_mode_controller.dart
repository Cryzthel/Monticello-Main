import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ThemeModeController extends ChangeNotifier {
  ThemeModeController._();
  static final ThemeModeController instance = ThemeModeController._();

  static const _kDarkModeGuestKey = 'monticello_dark_mode_guest';
  static const _kDarkModeUserPrefix = 'monticello_dark_mode_user_';
  String _activeKey = _kDarkModeGuestKey;

  bool _isDark = false;
  bool get isDark => _isDark;
  ThemeMode get themeMode => _isDark ? ThemeMode.dark : ThemeMode.light;

  Future<void> load({String? userId}) async {
    _activeKey = userId == null || userId.isEmpty
        ? _kDarkModeGuestKey
        : '$_kDarkModeUserPrefix$userId';
    final prefs = await SharedPreferences.getInstance();
    _isDark = prefs.getBool(_activeKey) ?? false;
    notifyListeners();
  }

  Future<void> loadForUser(String userId) => load(userId: userId);

  Future<void> loadGuest() => load();

  Future<void> setDarkMode(bool enabled) async {
    if (_isDark == enabled) return;
    _isDark = enabled;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_activeKey, enabled);
  }
}
