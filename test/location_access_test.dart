import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

import 'package:monticello_villas_app/core/location/location_access.dart';
import 'package:monticello_villas_app/core/location/location_status_chip.dart';

/// A scripted platform: answers what it is told and records what was asked.
class _FakePlatform implements LocationPlatform {
  _FakePlatform({
    this.services = true,
    this.permission = LocationPermission.denied,
    this.afterRequest = LocationPermission.whileInUse,
    this.throws = false,
    this.precise = true,
    this.preciseAfterRequest = true,
  });

  bool services;
  LocationPermission permission;
  LocationPermission afterRequest;
  bool throws;
  bool precise;
  bool preciseAfterRequest;

  int requests = 0;
  int fullAccuracyRequests = 0;
  int appSettings = 0;
  int locationSettings = 0;

  @override
  Future<LocationAccuracyStatus> getLocationAccuracy() async => precise
      ? LocationAccuracyStatus.precise
      : LocationAccuracyStatus.reduced;

  @override
  Future<LocationAccuracyStatus> requestTemporaryFullAccuracy() async {
    fullAccuracyRequests++;
    precise = preciseAfterRequest;
    return getLocationAccuracy();
  }

  @override
  Future<bool> isLocationServiceEnabled() async {
    if (throws) throw Exception('PermissionDefinitionsNotFoundException');
    return services;
  }

  @override
  Future<LocationPermission> checkPermission() async {
    if (throws) throw Exception('PermissionDefinitionsNotFoundException');
    return permission;
  }

  @override
  Future<LocationPermission> requestPermission() async {
    requests++;
    permission = afterRequest;
    // On Android, asking again while only approximate is held is the
    // system's "change to precise" dialog.
    precise = preciseAfterRequest;
    return permission;
  }

  @override
  Future<bool> openAppSettings() async {
    appSettings++;
    return true;
  }

  @override
  Future<bool> openLocationSettings() async {
    locationSettings++;
    return true;
  }
}

void main() {
  late _FakePlatform platform;

  void usePlatform(_FakePlatform p) {
    platform = p;
    LocationAccessService.platform = p;
  }

  group('LocationAccess.resolve', () {
    test('whileInUse and always are both granted', () {
      for (final p in [LocationPermission.whileInUse, LocationPermission.always]) {
        expect(
          LocationAccess.resolve(servicesEnabled: true, permission: p),
          LocationAccess.granted,
        );
      }
    });

    test('services off wins over any permission', () {
      // Granted permission with the switch off produces no fix, and must not
      // be reported as granted.
      for (final p in LocationPermission.values) {
        expect(
          LocationAccess.resolve(servicesEnabled: false, permission: p),
          LocationAccess.servicesOff,
        );
      }
    });

    test('denied can prompt; deniedForever cannot', () {
      final denied = LocationAccess.resolve(
          servicesEnabled: true, permission: LocationPermission.denied);
      final forever = LocationAccess.resolve(
          servicesEnabled: true, permission: LocationPermission.deniedForever);
      expect(denied, LocationAccess.denied);
      expect(denied.canPrompt, isTrue);
      expect(forever, LocationAccess.deniedForever);
      expect(forever.canPrompt, isFalse);
    });
  });

  group('LocationAccessService', () {
    test('check never prompts', () async {
      usePlatform(_FakePlatform());
      expect(await LocationAccessService.check(), LocationAccess.denied);
      expect(platform.requests, 0);
    });

    test('request prompts from denied and reports the answer', () async {
      usePlatform(_FakePlatform());
      expect(await LocationAccessService.request(), LocationAccess.granted);
      expect(platform.requests, 1);
    });

    test('a refusal at the prompt comes back as the refusal', () async {
      usePlatform(_FakePlatform(afterRequest: LocationPermission.deniedForever));
      expect(
          await LocationAccessService.request(), LocationAccess.deniedForever);
    });

    test('request does not prompt when the OS will not show one', () async {
      usePlatform(_FakePlatform(permission: LocationPermission.deniedForever));
      expect(
          await LocationAccessService.request(), LocationAccess.deniedForever);
      usePlatform(_FakePlatform(services: false));
      expect(await LocationAccessService.request(), LocationAccess.servicesOff);
      expect(platform.requests, 0);
    });

    test('a build that cannot ask reports unavailable, not denied', () async {
      // What the app did before the manifest declared location: geolocator
      // throws, and "denied" would send the resident to Settings for nothing.
      usePlatform(_FakePlatform(throws: true));
      expect(await LocationAccessService.check(), LocationAccess.unavailable);
      expect(await LocationAccessService.request(), LocationAccess.unavailable);
    });
  });

  group('approximate location', () {
    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('granted but reduced accuracy is approximate, and still shows', () {
      final a = LocationAccess.resolve(
        servicesEnabled: true,
        permission: LocationPermission.whileInUse,
        precise: false,
      );
      expect(a, LocationAccess.approximate);
      expect(a.isGranted, isTrue, reason: 'the pin still draws, blurred');
      expect(a.canPrompt, isFalse);
    });

    test('check reports approximate from the OS accuracy status', () async {
      usePlatform(_FakePlatform(
          permission: LocationPermission.whileInUse, precise: false));
      expect(await LocationAccessService.check(), LocationAccess.approximate);
    });

    test('Android upgrades through the permission request', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      usePlatform(_FakePlatform(
          permission: LocationPermission.whileInUse, precise: false));
      final after = await LocationStatusChip.resolve(LocationAccess.approximate);
      expect(platform.requests, 1);
      expect(platform.fullAccuracyRequests, 0);
      expect(after, LocationAccess.granted);
    });

    test('iOS upgrades through the full-accuracy request', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      usePlatform(_FakePlatform(
          permission: LocationPermission.whileInUse, precise: false));
      final after = await LocationStatusChip.resolve(LocationAccess.approximate);
      expect(platform.fullAccuracyRequests, 1);
      expect(platform.requests, 0);
      expect(after, LocationAccess.granted);
    });

    test('declining precise leaves it approximate, not broken', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      usePlatform(_FakePlatform(
        permission: LocationPermission.whileInUse,
        precise: false,
        preciseAfterRequest: false,
      ));
      expect(await LocationStatusChip.resolve(LocationAccess.approximate),
          LocationAccess.approximate);
    });
  });

  group('what the chip does after the system has answered', () {
    test('denied goes straight to the system prompt — no in-app dialog',
        () async {
      usePlatform(_FakePlatform());
      final after = await LocationStatusChip.resolve(LocationAccess.denied);
      expect(platform.requests, 1);
      expect(after, LocationAccess.granted);
    });

    test('permanently denied opens Settings and never prompts', () async {
      usePlatform(_FakePlatform(permission: LocationPermission.deniedForever));
      await LocationStatusChip.resolve(LocationAccess.deniedForever);
      expect(platform.appSettings, 1);
      expect(platform.requests, 0);
    });

    test('services off opens the location switch', () async {
      usePlatform(_FakePlatform(services: false));
      await LocationStatusChip.resolve(LocationAccess.servicesOff);
      expect(platform.locationSettings, 1);
      expect(platform.appSettings, 0);
    });

    test('unavailable does nothing, rather than looping', () async {
      usePlatform(_FakePlatform(throws: true));
      expect(await LocationStatusChip.resolve(LocationAccess.unavailable),
          LocationAccess.unavailable);
      expect(platform.requests + platform.appSettings, 0);
    });

    test('every missing state has its own words', () {
      final states = [
        LocationAccess.denied,
        LocationAccess.deniedForever,
        LocationAccess.servicesOff,
        LocationAccess.unavailable,
      ];
      final labels = [...states, LocationAccess.approximate]
          .map(LocationStatusChip.labelFor);
      expect(labels.toSet(), hasLength(states.length + 1));
      expect(labels, everyElement(isNotEmpty));
    });
  });

  group('the status chip', () {
    Future<void> pumpChip(WidgetTester tester, LocationAccess access,
        VoidCallback onTap) {
      return tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(child: LocationStatusChip(access: access, onTap: onTap)),
        ),
      ));
    }

    testWidgets('is absent when access is granted', (tester) async {
      await pumpChip(tester, LocationAccess.granted, () {});
      expect(find.byType(InkWell), findsNothing);
    });

    testWidgets('names the state and opens the sheet on tap', (tester) async {
      var taps = 0;
      await pumpChip(tester, LocationAccess.deniedForever, () => taps++);
      expect(find.text('Location blocked · Settings'), findsOneWidget);
      await tester.tap(find.text('Location blocked · Settings'));
      expect(taps, 1);
    });
  });
}
