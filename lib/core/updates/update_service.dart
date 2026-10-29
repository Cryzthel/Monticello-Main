import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/core/updates/app_release.dart';

/// In-app updates for the sideloaded APK.
///
/// The app is not on the Play Store, so nothing updates it in the background.
/// This checks `downloads/latest.json` (written by `scripts/deploy-apk.sh`) at
/// start-up and when the app returns to the foreground, and when a newer build
/// exists it downloads the APK into the app's cache, checks it against the
/// published SHA-256, and hands it to Android's package installer.
///
/// Installing over the top keeps everything: the release is signed with the
/// same upload key and has a higher versionCode, so Android treats it as an
/// update of this app — sign-in, preferences and the offline SOS queue all
/// survive. Nobody uninstalls.
///
/// Android only. Elsewhere [check] does nothing and the urgency stays `none`.
class UpdateService extends ChangeNotifier {
  UpdateService._();
  static final UpdateService instance = UpdateService._();

  static const manifestUrl = 'https://monticello-villas-f600e.web.app/downloads/latest.json';
  static const _channel = MethodChannel('monticello/updater');
  static const _dismissedKey = 'updates.dismissedBuild';

  /// How long a foreground return waits before asking again. A release is
  /// rare; a resident flicking between apps is not.
  static const _recheckAfter = Duration(minutes: 30);

  AppRelease? release;
  int installedBuild = 0;
  UpdateUrgency urgency = UpdateUrgency.none;
  UpdatePhase phase = UpdatePhase.idle;

  /// 0–1 while downloading; null when the size is unknown.
  double? progress;
  int receivedBytes = 0;
  String? error;

  int _dismissedBuild = 0;
  DateTime? _lastCheck;
  bool _checking = false;
  File? _verifiedApk;

  bool get supported => !kIsWeb && Platform.isAndroid;

  /// An optional update the resident has not waved away for this build.
  bool get offerOptional =>
      urgency == UpdateUrgency.optional && release != null && release!.buildNumber > _dismissedBuild;

  bool get busy => phase == UpdatePhase.downloading || phase == UpdatePhase.installing;

  Future<void> check({bool force = false}) async {
    if (!supported || _checking || busy) return;
    final last = _lastCheck;
    if (!force && last != null && DateTime.now().difference(last) < _recheckAfter) return;
    _checking = true;
    try {
      if (installedBuild == 0) {
        installedBuild = int.tryParse((await PackageInfo.fromPlatform()).buildNumber) ?? 0;
        _dismissedBuild = (await SharedPreferences.getInstance()).getInt(_dismissedKey) ?? 0;
      }
      final fetched = AppRelease.fromJson(await _fetchManifest());
      _lastCheck = DateTime.now();
      release = fetched;
      urgency = urgencyFor(installedBuild: installedBuild, release: fetched);
      notifyListeners();
    } catch (err) {
      // Offline, Hosting unreachable, malformed JSON: carry on as we are. A
      // failed check must never block the app, and a required update already
      // decided stays decided.
      debugPrint('Update check failed: $err');
    } finally {
      _checking = false;
    }
  }

  Future<Object?> _fetchManifest() async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      // The query defeats any cache between here and Hosting; the file itself
      // is already served no-cache.
      final uri = Uri.parse('$manifestUrl?t=${DateTime.now().millisecondsSinceEpoch}');
      final response = await (await client.getUrl(uri)).close().timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) throw HttpException('HTTP ${response.statusCode}', uri: uri);
      return jsonDecode(await response.transform(utf8.decoder).join());
    } finally {
      client.close(force: true);
    }
  }

  /// "Later" on the optional prompt: quiet until a newer build than this.
  Future<void> dismissOptional() async {
    final build = release?.buildNumber;
    if (build == null) return;
    _dismissedBuild = build;
    notifyListeners();
    await (await SharedPreferences.getInstance()).setInt(_dismissedKey, build);
  }

  /// Download (or reuse a verified download), then install.
  Future<void> startUpdate() async {
    final target = release;
    if (target == null || busy) return;
    error = null;
    try {
      final apk = await _download(target);
      await _install(apk);
    } catch (err) {
      debugPrint('Update failed: $err');
      error = err is UpdateFailure ? err.message : 'The update could not be downloaded. Check your connection and try again.';
      phase = UpdatePhase.failed;
      notifyListeners();
    }
  }

  /// Called when the app returns to the foreground: after the resident allowed
  /// installs from this app in Settings, carry straight on to the installer;
  /// otherwise re-check for a release.
  Future<void> onResume() async {
    if (phase == UpdatePhase.needsPermission && _verifiedApk != null) {
      if (await _canInstall()) {
        await _install(_verifiedApk!);
        return;
      }
    }
    if (phase == UpdatePhase.installing) {
      // Back from the installer without updating (cancelled, or it failed).
      phase = UpdatePhase.ready;
      notifyListeners();
    }
    await check();
  }

  /// Opens the "Install unknown apps" page for this app.
  Future<void> openInstallSettings() => _channel.invokeMethod<bool>('openInstallSettings');

  Future<File> _download(AppRelease target) async {
    final dir = Directory(await _channel.invokeMethod<String>('downloadDir') ?? '');
    if (dir.path.isEmpty) throw const UpdateFailure('There is no space to download the update.');
    await dir.create(recursive: true);
    final file = File('${dir.path}/monticello-${target.buildNumber}.apk');

    // A download from an earlier attempt that checks out is reused, so a
    // resident who backed out of the installer does not fetch 115 MB again.
    if (_verifiedApk?.path == file.path && await file.exists()) return file;
    await for (final old in dir.list()) {
      if (old is File && old.path != file.path) await old.delete().catchError((_) => old);
    }
    if (await file.exists() && target.sha256 != null && await _sha256Of(file) == target.sha256) {
      _verifiedApk = file;
      return file;
    }

    phase = UpdatePhase.downloading;
    progress = 0;
    receivedBytes = 0;
    notifyListeners();

    final client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    final partial = File('${file.path}.part');
    try {
      final response = await (await client.getUrl(Uri.parse(target.url))).close();
      if (response.statusCode != 200) {
        throw UpdateFailure('The update is not available right now (HTTP ${response.statusCode}). Try again later.');
      }
      final total = response.contentLength > 0 ? response.contentLength : target.sizeBytes;
      final digestSink = _DigestSink();
      final hasher = sha256.startChunkedConversion(digestSink);
      final out = partial.openWrite();
      var lastPaint = DateTime.fromMillisecondsSinceEpoch(0);
      try {
        await for (final chunk in response.timeout(const Duration(seconds: 30))) {
          out.add(chunk);
          hasher.add(chunk);
          receivedBytes += chunk.length;
          // Repaint a few times a second, not once per 64 KB chunk.
          final now = DateTime.now();
          if (now.difference(lastPaint) > const Duration(milliseconds: 120)) {
            lastPaint = now;
            progress = total == null || total <= 0 ? null : (receivedBytes / total).clamp(0.0, 1.0);
            notifyListeners();
          }
        }
      } finally {
        await out.close();
        hasher.close();
      }
      if (target.sizeBytes != null && receivedBytes != target.sizeBytes) {
        throw const UpdateFailure('The download was cut short. Try again on a steadier connection.');
      }
      if (target.sha256 != null && digestSink.value.toString() != target.sha256) {
        throw const UpdateFailure("The downloaded file didn't match the published release, so it was not installed. Try again.");
      }
      await partial.rename(file.path);
      _verifiedApk = file;
      progress = 1;
      phase = UpdatePhase.ready;
      notifyListeners();
      return file;
    } on TimeoutException {
      throw const UpdateFailure('The download stalled. Check your connection and try again.');
    } finally {
      client.close(force: true);
      if (await partial.exists()) await partial.delete().catchError((_) => partial);
    }
  }

  Future<void> _install(File apk) async {
    if (!await _canInstall()) {
      // Android 8+ asks once per app: "Allow from this source". The resident
      // is sent to that switch; [onResume] continues when they come back.
      phase = UpdatePhase.needsPermission;
      notifyListeners();
      await openInstallSettings();
      return;
    }
    phase = UpdatePhase.installing;
    notifyListeners();
    final started = await _channel.invokeMethod<bool>('install', {'path': apk.path}) ?? false;
    if (!started) throw const UpdateFailure('Android could not open the installer for this update.');
  }

  Future<bool> _canInstall() async => await _channel.invokeMethod<bool>('canInstall') ?? false;

  static Future<String> _sha256Of(File file) async => (await sha256.bind(file.openRead()).first).toString();
}

enum UpdatePhase {
  idle,
  downloading,

  /// Downloaded and verified; the installer was not (or no longer is) open.
  ready,

  /// Waiting on "Install unknown apps" for this app.
  needsPermission,

  /// The system installer is open.
  installing,
  failed,
}

class UpdateFailure implements Exception {
  const UpdateFailure(this.message);
  final String message;
  @override
  String toString() => message;
}

class _DigestSink implements Sink<Digest> {
  late Digest value;
  @override
  void add(Digest data) => value = data;
  @override
  void close() {}
}
