import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/features/contact/widgets/hoa_contact_sheet.dart';

/// One guardhouse number an offline SOS is texted to.
@immutable
class SmsRecipient {
  const SmsRecipient({required this.label, required this.number});

  final String label;
  final String number;

  /// Digits and a leading +, as an SMS URI wants them.
  String get dialable => number.replaceAll(RegExp(r'[^\d+]'), '');

  Map<String, String> toJson() => {'label': label, 'number': number};

  static SmsRecipient? fromJson(Object? json) {
    if (json is! Map) return null;
    final label = (json['label'] as Object?)?.toString().trim() ?? '';
    final number = (json['number'] as Object?)?.toString().trim() ?? '';
    final digits = number.replaceAll(RegExp(r'\D'), '');
    if (number.isEmpty || digits.length < 7 || digits.length > 13) return null;
    return SmsRecipient(label: label.isEmpty ? number : label, number: number);
  }
}

/// The guardhouse numbers an SOS falls back to when it cannot reach the
/// server, as Admin › Settings › "Guardhouse SMS numbers" sets them.
///
/// Read from `system_settings/resident_sos` (a mirror of the staff-only
/// settings that residents are allowed to read) and kept on the phone, because
/// the one moment this list is needed is the moment there is no internet to
/// fetch it. [refresh] runs at start-up and whenever the SOS sheet opens; the
/// SMS fallback reads [current] synchronously.
///
/// Before an administrator has saved any numbers — or if this phone has never
/// been online since installing — [current] is the guard roster built into
/// the app ([HoaContact.guards]), so the fallback is never addressed to nobody.
class SosSmsRecipients {
  SosSmsRecipients._();

  static const int max = 3;
  static const _prefsKey = 'sos.smsRecipients';
  static const _docPath = 'system_settings/resident_sos';

  static List<SmsRecipient> _saved = const [];
  static bool _loaded = false;

  /// The numbers to text: the saved list, or the built-in roster.
  static List<SmsRecipient> get current => _saved.isNotEmpty ? _saved : builtIn;

  /// Whether [current] came from Admin settings rather than the app's roster.
  static bool get fromSettings => _saved.isNotEmpty;

  static List<SmsRecipient> get builtIn => [
        for (final guard in HoaContact.guards.take(max))
          SmsRecipient(label: guard.name, number: guard.number),
      ];

  /// The phone's copy. Cheap; safe to call repeatedly.
  static Future<void> load() async {
    if (_loaded) return;
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_prefsKey);
      if (raw != null) _saved = _parse(jsonDecode(raw));
    } catch (err) {
      debugPrint('SOS SMS recipients: stored copy unreadable ($err)');
    }
    _loaded = true;
  }

  /// Fetches the current list and stores it. Never throws: offline, signed
  /// out or refused, the stored copy simply stays in use.
  static Future<void> refresh() async {
    await load();
    try {
      final snap = await FirebaseFirestore.instance.doc(_docPath).get().timeout(const Duration(seconds: 8));
      // A cache-only answer is not news: it is what was stored already.
      if (snap.metadata.isFromCache) return;
      final next = snap.exists ? _parse(snap.data()?['smsRecipients']) : const <SmsRecipient>[];
      _saved = next;
      await (await SharedPreferences.getInstance())
          .setString(_prefsKey, jsonEncode([for (final r in next) r.toJson()]));
    } catch (err) {
      debugPrint('SOS SMS recipients: refresh skipped ($err)');
    }
  }

  static List<SmsRecipient> _parse(Object? list) {
    if (list is! List) return const [];
    return list.map(SmsRecipient.fromJson).whereType<SmsRecipient>().take(max).toList();
  }

  @visibleForTesting
  static void debugSet(List<SmsRecipient> saved) {
    _saved = saved;
    _loaded = true;
  }
}
