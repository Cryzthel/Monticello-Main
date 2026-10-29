import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_alert_record.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sms_fallback.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sms_recipients.dart';

const _guards = [
  SmsRecipient(label: 'Main gate', number: '0951 280 1347'),
  SmsRecipient(label: 'Back gate', number: '+63 907 897 0640'),
];

SosPayload _payload({String id = 'a'}) => SosPayload(
      alertId: id,
      residentUid: 'uid',
      residentName: 'Ana Cruz',
      residentPhone: '',
      propertyPhase: '1',
      propertyBlock: '4',
      propertyLot: '12',
      propertyLabel: 'Phase 1 • Block 4 • Lot 12',
      capturedAt: DateTime(2026, 10, 29, 21, 5),
      emergencyType: 'general',
      lat: 14.12345,
      lng: 121.54321,
    );

void main() {
  group('SMS URI', () {
    test('Android URI fallback: every number, separated by , (Google Messages)', () {
      final uri = SosSmsFallback.buildUri(_guards, 'SOS now', ios: false).toString();
      expect(uri, startsWith('sms:09512801347,+639078970640?body='));
    });

    test('iOS: the addresses form, comma-separated', () {
      final uri = SosSmsFallback.buildUri(_guards, 'SOS now', ios: true).toString();
      expect(uri, startsWith('sms:/open?addresses=09512801347,+639078970640&body='));
    });

    test('spaces encode as %20, never +, so Messages shows real spaces', () {
      final uri = SosSmsFallback.buildUri(_guards, 'SOS Monticello Villas | Lot 12', ios: true).toString();
      expect(uri, contains('SOS%20Monticello%20Villas%20%7C%20Lot%2012'));
      expect(uri, isNot(contains('SOS+Monticello')));
    });

    test('the body carries name, lot, time with date, and a map link', () {
      final body = _payload().toSmsBody();
      expect(body, contains('Ana Cruz'));
      expect(body, contains('Phase 1 • Block 4 • Lot 12'));
      expect(body, contains('at 21:05 Oct 29'));
      expect(body, contains('maps.google.com/?q=14.12345,121.54321'));
    });
  });

  group('SosSmsRecipients', () {
    test('saved numbers win over the built-in roster', () {
      SosSmsRecipients.debugSet(_guards);
      expect(SosSmsRecipients.current, _guards);
      expect(SosSmsRecipients.fromSettings, isTrue);
    });

    test('nothing saved falls back to the roster, never to nobody', () {
      SosSmsRecipients.debugSet(const []);
      expect(SosSmsRecipients.current, isNotEmpty);
      expect(SosSmsRecipients.fromSettings, isFalse);
    });

    test('a stored entry needs a real number', () {
      expect(SmsRecipient.fromJson({'label': 'Gate', 'number': '0951 280 1347'})?.dialable, '09512801347');
      expect(SmsRecipient.fromJson({'label': 'Gate', 'number': '12'}), isNull);
      expect(SmsRecipient.fromJson({'label': 'Gate'}), isNull);
      expect(SmsRecipient.fromJson('nope'), isNull);
      // No label: the number names itself.
      expect(SmsRecipient.fromJson({'number': '09512801347'})?.label, '09512801347');
    });
  });

  group('SOS history', () {
    SosAlertRecord rec(String id, DateTime at, SosStage stage) =>
        SosAlertRecord(id: id, stage: stage, raisedAt: at);

    test('stages read in the residents\' words', () {
      expect(SosStage.dispatched.label, 'Dispatched');
      expect(SosStage.inProgress.label, 'Dispatch in progress');
      expect(SosStage.resolved.label, 'Resolved');
      expect(SosStage.resolved.isOpen, isFalse);
    });

    test('newest first, and a queued alert that landed is shown once', () {
      final server = [
        rec('old', DateTime(2026, 10, 1), SosStage.resolved),
        rec('landed', DateTime(2026, 10, 20), SosStage.dispatched),
      ];
      final queued = [
        SosAlertRecord.queued(_payload(id: 'landed')),
        SosAlertRecord.queued(_payload(id: 'waiting')),
      ];
      final merged = mergeSosHistory(server, queued);
      expect(merged.map((r) => r.id), ['waiting', 'landed', 'old']);
      expect(merged.first.stage, SosStage.waiting);
      expect(merged[1].stage, SosStage.dispatched);
    });

    test('each stage has its own time', () {
      final r = SosAlertRecord(
        id: 'x',
        stage: SosStage.resolved,
        raisedAt: DateTime(2026, 10, 29, 21, 5),
        receivedAt: DateTime(2026, 10, 29, 21, 5, 2),
        respondedAt: DateTime(2026, 10, 29, 21, 7),
        resolvedAt: DateTime(2026, 10, 29, 21, 30),
      );
      expect(r.timeOf(SosStage.dispatched), DateTime(2026, 10, 29, 21, 5, 2));
      expect(r.timeOf(SosStage.inProgress), DateTime(2026, 10, 29, 21, 7));
      expect(r.timeOf(SosStage.resolved), DateTime(2026, 10, 29, 21, 30));
    });
  });

  group('groupNotificationsByDate', () {
    final now = DateTime(2026, 10, 29, 10, 0);
    ResidentNotification n(String id, DateTime at) => ResidentNotification(
          event: NotificationEvent.dispatched,
          at: at,
          sourceId: id,
          headline: id,
          detail: '',
          tint: AppColors.info,
          icon: Icons.send,
        );

    test('Today, Yesterday, Last 7 Days, Last 30 Days, Older — by calendar day', () {
      final feed = [
        n('older', DateTime(2026, 9, 1)),
        n('today-early', DateTime(2026, 10, 29, 0, 5)),
        n('yesterday-late', DateTime(2026, 10, 28, 23, 50)),
        n('six-days', DateTime(2026, 10, 23, 12)),
        n('seven-days', DateTime(2026, 10, 22, 12)),
        n('today-late', DateTime(2026, 10, 29, 9, 30)),
      ];
      final groups = groupNotificationsByDate(feed, now);
      expect(groups.map((g) => g.label), ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older']);
      expect(groups[0].items.map((x) => x.sourceId), ['today-late', 'today-early']);
      expect(groups[1].items.single.sourceId, 'yesterday-late');
      expect(groups[2].items.single.sourceId, 'six-days');
      expect(groups[3].items.single.sourceId, 'seven-days');
      expect(groups[4].items.single.sourceId, 'older');
    });

    test('empty groups are left out', () {
      final groups = groupNotificationsByDate([n('a', DateTime(2026, 10, 27))], now);
      expect(groups.map((g) => g.label), ['Last 7 Days']);
    });
  });
}
