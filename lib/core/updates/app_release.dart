/// The published Android release, as `downloads/latest.json` on Firebase
/// Hosting describes it, and the rule that decides what an installed build
/// should do about it.
///
/// `scripts/deploy-apk.sh` writes that file on every release, so the manifest
/// can never disagree with the APK beside it: the version, the download URL,
/// the SHA-256 the download is checked against, and `minimumBuildNumber`, the
/// oldest build still allowed to run. A file of `null` (before the first
/// release) or anything unreadable means "nothing to offer".
library;

/// What the installed app should do about the published release.
enum UpdateUrgency {
  /// Up to date, or nothing published.
  none,

  /// A newer build exists; the resident may install it or carry on.
  optional,

  /// The installed build is below the published minimum. The app is blocked
  /// until it is updated, so an old client never talks to a backend (rules,
  /// fields, functions) that has moved on without it.
  required,
}

class AppRelease {
  const AppRelease({
    required this.version,
    required this.buildNumber,
    required this.minimumBuildNumber,
    required this.url,
    this.permanentUrl,
    this.sha256,
    this.sizeBytes,
    this.releasedAt,
  });

  /// "1.2.0" — what residents are shown.
  final String version;

  /// The Android versionCode. Comparisons use this, never [version]: it is the
  /// number Android itself refuses to downgrade.
  final int buildNumber;

  /// Builds below this must update before they can be used. 0 when the
  /// manifest predates the field, which makes every update optional.
  final int minimumBuildNumber;

  final String url;

  /// The always-newest download link, offered as a browser fallback.
  final String? permanentUrl;

  /// Lower-case hex SHA-256 of the APK at [url].
  final String? sha256;
  final int? sizeBytes;
  final DateTime? releasedAt;

  /// Parses the manifest, or returns null for anything that is not a usable
  /// release (the `null` placeholder, a missing URL, a non-numeric build).
  static AppRelease? fromJson(Object? json) {
    if (json is! Map) return null;
    final build = _int(json['buildNumber']);
    final url = json['url'];
    if (build == null || build <= 0 || url is! String || url.isEmpty) return null;
    final sha = json['sha256'];
    return AppRelease(
      version: json['version'] is String ? json['version'] as String : '$build',
      buildNumber: build,
      minimumBuildNumber: _int(json['minimumBuildNumber']) ?? 0,
      url: url,
      permanentUrl: json['permanentUrl'] is String ? json['permanentUrl'] as String : null,
      sha256: sha is String && RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(sha) ? sha.toLowerCase() : null,
      sizeBytes: _int(json['sizeBytes']),
      releasedAt: json['releasedAt'] is String ? DateTime.tryParse(json['releasedAt'] as String) : null,
    );
  }

  static int? _int(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}

/// The decision, kept pure so it is tested without a device.
///
/// Required wins only when the published build can actually fix it: a
/// minimum set above the newest published build would otherwise lock every
/// resident out with no way forward.
UpdateUrgency urgencyFor({required int installedBuild, required AppRelease? release}) {
  if (release == null || release.buildNumber <= installedBuild) return UpdateUrgency.none;
  if (installedBuild < release.minimumBuildNumber) return UpdateUrgency.required;
  return UpdateUrgency.optional;
}

/// "115 MB" / "640 KB", for the download line.
String formatMegabytes(int bytes) {
  if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB';
  return '${(bytes / 1024).ceil()} KB';
}
