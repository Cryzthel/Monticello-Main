import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// The installed version, read from the package itself (the APK's
/// versionName / versionCode, which pubspec.yaml's `version:` sets at build
/// time). It replaced a hard-coded 'v1.0.0' in Settings that stayed '1.0.0'
/// through every release, so it disagreed with the installer and the
/// in-app updater about which build a phone was running.
class AppVersion {
  AppVersion._();

  static Future<String>? _label;

  /// "v1.2.3 (6)", read once per run.
  static Future<String> label() => _label ??= _read();

  static Future<String> _read() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final build = info.buildNumber.isEmpty ? '' : ' (${info.buildNumber})';
      return 'v${info.version}$build';
    } catch (_) {
      return 'v—';
    }
  }
}

/// [AppVersion.label] as text, with [prefix] before it.
class AppVersionText extends StatelessWidget {
  const AppVersionText({super.key, this.prefix = '', required this.style});

  final String prefix;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: AppVersion.label(),
      builder: (context, snap) => Text('$prefix${snap.data ?? ''}', style: style),
    );
  }
}
