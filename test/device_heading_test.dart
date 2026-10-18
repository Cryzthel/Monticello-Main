import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/location/device_heading.dart';

/// The heading cone is only drawn when the phone can know which way it faces.
/// A cone stuck at 0° on a compass-less phone reads as "facing north".
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  setUp(DeviceHeading.resetCache);
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    messenger.setMockMethodCallHandler(DeviceHeading.channel, null);
  });

  test('Android asks the sensor manager and believes it', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    var calls = 0;
    messenger.setMockMethodCallHandler(DeviceHeading.channel, (call) async {
      calls++;
      expect(call.method, 'isAvailable');
      return false;
    });

    expect(await DeviceHeading.isAvailable(), isFalse);
    // Cached: one platform call per run, not one per marker refresh.
    expect(await DeviceHeading.isAvailable(), isFalse);
    expect(calls, 1);
  });

  test('a channel failure means no cone, not a crash', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    messenger.setMockMethodCallHandler(DeviceHeading.channel, (call) async {
      throw PlatformException(code: 'boom');
    });
    expect(await DeviceHeading.isAvailable(), isFalse);
  });

  test('every iPhone has a magnetometer', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(await DeviceHeading.isAvailable(), isTrue);
  });
}
