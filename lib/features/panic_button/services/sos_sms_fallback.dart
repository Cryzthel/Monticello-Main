import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/features/contact/widgets/hoa_contact_sheet.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';

/// Hands a queued emergency to the cellular network when the data network is
/// gone.
///
/// ── WHY THIS DRAFTS AND DOES NOT SEND ─────────────────────────────────────
/// The obvious implementation is to send the SMS silently, and on neither
/// platform is that something the app can actually promise:
///
///   • iOS has no API for sending an SMS without the user. `MFMessageViewController`
///     always presents the composer and always requires a tap. There is no
///     entitlement, private or otherwise, that changes this.
///   • Android can, with the SEND_SMS permission — which Google Play classes as
///     restricted. An app that is not the user's default SMS handler needs a
///     granted declaration to keep it, and "emergency alerts" is not one of the
///     approved use cases. Shipping it is a plausible route to removal from
///     Play, which would take the whole app — including the SOS button — down
///     with it.
///
/// So the composer opens pre-filled and the resident presses send. That is one
/// tap on a screen they are already looking at, and it is honest: the app never
/// tells anyone a message went out that a carrier never accepted. The UI copy
/// is written to match — it says the draft is ready, not that it was sent.
///
/// The queued Firestore delivery is unaffected and still the primary path.
/// This is the belt to its braces, for the case where there is no data at all
/// but a voice/SMS bar is still showing.
class SosSmsFallback {
  SosSmsFallback._();

  /// Where the fallback goes. The MAIN GATE, not the office line — the
  /// office keeps business hours and an emergency does not.
  ///
  /// This read `HoaContact.hotlineNumber` until the real directory landed.
  /// That constant was a placeholder (`+63 917 765 4321`) and it is now
  /// gone, so the offline SOS was addressed to a number that reaches nobody
  /// — on the one path that exists for when there is no data at all. The
  /// gate is the line that is always staffed, which is what this needs.
  static String get recipient => HoaContact.mainGateNumber;

  /// Opens the platform SMS composer addressed to the guardhouse with the
  /// alert already written out.
  ///
  /// Returns false if no messaging app could be opened (a tablet, an emulator,
  /// a data-only device). Callers must treat that as "the fallback is not
  /// available", not as "the alert failed" — the encrypted queue still holds
  /// it and the sync service will still deliver it.
  static Future<bool> compose(SosPayload payload) async {
    final uri = Uri(
      scheme: 'sms',
      path: recipient.replaceAll(RegExp(r'[^\d+]'), ''),
      // `body` is honoured by iOS Messages and by every mainstream Android SMS
      // app. Where it is ignored the composer still opens addressed correctly,
      // which is the part that matters.
      queryParameters: {'body': payload.toSmsBody()},
    );
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint('SOS SMS fallback unavailable: $e');
      return false;
    }
  }
}
