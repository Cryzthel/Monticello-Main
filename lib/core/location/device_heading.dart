import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Whether this phone can report which way it is facing.
///
/// The home map's heading cone is driven by the device compass. On a phone
/// without one, Mapbox's heading puck never receives a heading and sits at 0°
/// — a cone confidently pointing north, which is worse than no cone. So the
/// cone is only drawn when this says yes.
///
/// Android asks the sensor manager (MainActivity, channel
/// `monticello/heading`). Every iPhone has a magnetometer, so iOS answers yes
/// without a round trip. Anything else, or any failure, is no.
class DeviceHeading {
  DeviceHeading._();

  static const MethodChannel channel = MethodChannel('monticello/heading');

  static bool? _cached;

  static Future<bool> isAvailable() async {
    final cached = _cached;
    if (cached != null) return cached;
    bool answer;
    if (kIsWeb) {
      answer = false;
    } else if (defaultTargetPlatform == TargetPlatform.iOS) {
      answer = true;
    } else if (defaultTargetPlatform == TargetPlatform.android) {
      try {
        answer = await channel.invokeMethod<bool>('isAvailable') ?? false;
      } catch (_) {
        answer = false;
      }
    } else {
      answer = false;
    }
    return _cached = answer;
  }

  @visibleForTesting
  static void resetCache() => _cached = null;
}
