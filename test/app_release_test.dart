import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/updates/app_release.dart';

AppRelease release({int build = 5, int minimum = 0}) =>
    AppRelease(version: '1.$build.0', buildNumber: build, minimumBuildNumber: minimum, url: 'https://x/a.apk');

void main() {
  group('urgencyFor', () {
    test('nothing published means no update', () {
      expect(urgencyFor(installedBuild: 3, release: null), UpdateUrgency.none);
    });

    test('same or older published build means no update', () {
      expect(urgencyFor(installedBuild: 5, release: release(build: 5)), UpdateUrgency.none);
      expect(urgencyFor(installedBuild: 6, release: release(build: 5, minimum: 9)), UpdateUrgency.none);
    });

    test('a newer build at or above the minimum is optional', () {
      expect(urgencyFor(installedBuild: 4, release: release(build: 5)), UpdateUrgency.optional);
      expect(urgencyFor(installedBuild: 4, release: release(build: 5, minimum: 4)), UpdateUrgency.optional);
    });

    test('a build below the minimum is required', () {
      expect(urgencyFor(installedBuild: 3, release: release(build: 5, minimum: 5)), UpdateUrgency.required);
      expect(urgencyFor(installedBuild: 3, release: release(build: 5, minimum: 4)), UpdateUrgency.required);
    });
  });

  group('AppRelease.fromJson', () {
    test('reads the manifest deploy-apk.sh writes', () {
      final r = AppRelease.fromJson({
        'app': 'Monticello Villas',
        'version': '1.2.0',
        'buildNumber': 3,
        'minimumBuildNumber': 2,
        'url': 'https://h/downloads/monticello-v1.2.0-release.apk',
        'permanentUrl': 'https://h/downloads/monticello-release.apk',
        'sizeBytes': 120698570,
        'sha256': 'BC223AC70D8C1303CAAFCB3135603855D53AE0BC44D99CFE0A289B13ECF5376E',
        'releasedAt': '2026-10-29T07:57:41Z',
      })!;
      expect(r.buildNumber, 3);
      expect(r.minimumBuildNumber, 2);
      expect(r.sha256, 'bc223ac70d8c1303caafcb3135603855d53ae0bc44d99cfe0a289b13ecf5376e');
      expect(r.sizeBytes, 120698570);
      expect(r.releasedAt, DateTime.utc(2026, 10, 29, 7, 57, 41));
    });

    test('a manifest from before minimumBuildNumber makes updates optional', () {
      final r = AppRelease.fromJson({'version': '1.1.0', 'buildNumber': 2, 'url': 'https://h/a.apk'})!;
      expect(r.minimumBuildNumber, 0);
      expect(urgencyFor(installedBuild: 1, release: r), UpdateUrgency.optional);
    });

    test('the null placeholder and broken manifests are ignored', () {
      expect(AppRelease.fromJson(null), isNull);
      expect(AppRelease.fromJson({'version': '1.0.0'}), isNull);
      expect(AppRelease.fromJson({'buildNumber': 'x', 'url': 'https://h/a.apk'}), isNull);
      expect(AppRelease.fromJson({'buildNumber': 2, 'url': ''}), isNull);
    });

    test('a malformed checksum is dropped rather than trusted', () {
      final r = AppRelease.fromJson({'buildNumber': 2, 'url': 'https://h/a.apk', 'sha256': 'abc'})!;
      expect(r.sha256, isNull);
    });
  });

  test('formatMegabytes', () {
    expect(formatMegabytes(120698570), '115 MB');
    expect(formatMegabytes(5 * 1024 * 1024 + 300000), '5.3 MB');
    expect(formatMegabytes(2000), '2 KB');
  });
}
