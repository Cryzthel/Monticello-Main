import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sms_recipients.dart';

/// Hands an emergency to the cellular network when the data network is gone.
///
/// ── WHY THIS DRAFTS AND DOES NOT SEND ─────────────────────────────────────
/// The obvious implementation is to send the SMS silently, and on neither
/// platform is that something the app can actually promise:
///
///   • iOS has no API for sending an SMS without the user. The composer always
///     opens and always needs a tap.
///   • Android can, with SEND_SMS — which Google classes as restricted for any
///     app that is not the default SMS handler, and "emergency alerts" is not
///     an approved use. It is deliberately not requested.
///
/// So the phone's own messaging app opens addressed to every guardhouse
/// number with the alert written out, and the resident presses send. That is
/// one tap, and it is honest: the app never says a message went out that a
/// carrier never accepted.
///
/// The queued Firestore delivery is unaffected and still the primary path.
class SosSmsFallback {
  SosSmsFallback._();

  /// Builds the `sms:` URI for [recipients] and [body].
  ///
  /// Written by hand rather than through `Uri(queryParameters:)`, which
  /// encodes spaces as `+` — iOS Messages shows those literally, so the alert
  /// would arrive as "SOS+Monticello+Villas". `Uri.encodeComponent` gives
  /// `%20`, which every client decodes.
  ///
  /// Several recipients: Android takes them separated by `;` (Google Messages
  /// and Samsung Messages both accept it; Samsung rejects `,`); iOS takes the
  /// `/open?addresses=` form, comma-separated.
  @visibleForTesting
  static Uri buildUri(List<SmsRecipient> recipients, String body, {required bool ios}) {
    final numbers = recipients.map((r) => r.dialable).where((n) => n.isNotEmpty).toList();
    final text = Uri.encodeComponent(body);
    if (ios) {
      return Uri.parse('sms:/open?addresses=${numbers.join(',')}&body=$text');
    }
    return Uri.parse('sms:${numbers.join(',')}?body=$text');
  }

  static const _channel = MethodChannel('monticello/sms');

  /// Opens the SMS composer addressed to the guardhouse numbers in
  /// [SosSmsRecipients] with [payload] written out.
  ///
  /// Returns false if no messaging app could be opened (a tablet, an emulator,
  /// a data-only device). Callers treat that as "the fallback is not
  /// available", not as "the alert failed" — the encrypted queue still holds
  /// it and the sync service will still deliver it.
  static Future<bool> compose(SosPayload payload) async {
    await SosSmsRecipients.load();
    final recipients = SosSmsRecipients.current;
    final body = payload.toSmsBody();

    // Android: an explicit SENDTO intent through MainActivity.composeSms,
    // which does not depend on url_launcher resolving an `sms:` URI (the
    // "Could not launch sms:" failure) and passes the body as an extra too.
    if (defaultTargetPlatform == TargetPlatform.android) {
      try {
        final opened = await _channel.invokeMethod<bool>('compose', {
          'numbers': [for (final r in recipients) r.dialable],
          'body': body,
        });
        if (opened == true) return true;
      } catch (e) {
        debugPrint('SOS SMS intent failed, trying the URI: $e');
      }
    }

    final uri = buildUri(recipients, body, ios: defaultTargetPlatform == TargetPlatform.iOS);
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('SOS SMS fallback unavailable: $e');
      return false;
    }
  }
}
