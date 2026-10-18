import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_queue.dart';

SosPayload _payload({
  String id = 'uid_1700000000000',
  DateTime? capturedAt,
  double? lat,
  double? lng,
}) {
  return SosPayload(
    alertId: id,
    residentUid: 'uid',
    residentName: 'Maria Dela Cruz',
    residentPhone: '+63 917 000 1111',
    propertyPhase: '2',
    propertyBlock: '7',
    propertyLot: '14',
    propertyLabel: 'Phase 2 • Block 7 • Lot 14',
    capturedAt: capturedAt ?? DateTime(2026, 8, 20, 21, 5),
    emergencyType: 'general',
    lat: lat,
    lng: lng,
  );
}

// ── SosQueue against a stubbed secure store ────────────────────────────────
// The real plugin talks to the Keychain / Keystore, neither of which exists in
// a test VM. Standing in an in-memory map at the channel boundary exercises
// every line of SosQueue's own logic — dedupe, ordering, the serialisation
// lock — without pretending to test the platform's crypto.
void _installFakeSecureStorage(Map<String, String> store) {
  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async {
    final args = (call.arguments as Map?)?.cast<String, dynamic>() ?? {};
    switch (call.method) {
      case 'write':
        store[args['key'] as String] = args['value'] as String;
        return null;
      case 'read':
        return store[args['key'] as String];
      case 'delete':
        store.remove(args['key'] as String);
        return null;
      case 'readAll':
        return Map<String, String>.from(store);
      case 'deleteAll':
        store.clear();
        return null;
      default:
        return null;
    }
  });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SosPayload survives the trip to disk', () {
    test('round-trips every field a guard needs', () {
      final original = _payload(lat: 14.12345, lng: 121.54321);
      final restored = SosPayload.fromJson(original.toJson());

      expect(restored.alertId, original.alertId);
      expect(restored.residentName, original.residentName);
      expect(restored.residentPhone, original.residentPhone);
      expect(restored.propertyLabel, original.propertyLabel);
      expect(restored.lat, original.lat);
      expect(restored.lng, original.lng);
      // The capture time is the whole reason a delayed alert is not a lie.
      expect(restored.capturedAt, original.capturedAt);
    });

    test('a corrupt queue yields an empty list, never a throw', () {
      // Losing a stale queued alert is bad. An SOS button that throws on the
      // way to disk is worse.
      expect(SosPayload.decodeList('{not json'), isEmpty);
      expect(SosPayload.decodeList('{"an":"object"}'), isEmpty);
      expect(SosPayload.decodeList(''), isEmpty);
    });

    test('encodeList/decodeList preserves order and count', () {
      final items = [
        _payload(id: 'a', capturedAt: DateTime(2026, 8, 20, 20)),
        _payload(id: 'b', capturedAt: DateTime(2026, 8, 20, 21)),
      ];
      final restored = SosPayload.decodeList(SosPayload.encodeList(items));
      expect(restored.map((e) => e.alertId), ['a', 'b']);
    });
  });

  group('Firestore wire format', () {
    test('a queued alert carries the time it was RAISED, not the time it synced',
        () {
      final raised = DateTime.now().subtract(const Duration(minutes: 20));
      final doc = _payload(capturedAt: raised).toFirestore(queued: true);

      // If this regressed to a server timestamp, a twenty-minute-old emergency
      // would arrive on the dispatch map looking like breaking news and would
      // sort ahead of alerts that really are newer.
      expect(doc['createdAt'], isA<Timestamp>());
      expect((doc['createdAt'] as Timestamp).toDate(), raised);
      expect(doc['deliveredOffline'], isTrue);
      expect(doc['queuedForSeconds'], closeTo(1200, 5));
    });

test('a device clock running ahead never reports a negative hold', () {
      final future = DateTime.now().add(const Duration(hours: 4));
      final doc = _payload(capturedAt: future).toFirestore(queued: true);
      expect(doc['queuedForSeconds'], 0);
    });

    test('a live alert still takes the server clock', () {
      final doc = _payload().toFirestore(queued: false);
      expect(doc['createdAt'], isA<FieldValue>());
      expect(doc['deliveredOffline'], isFalse);
      expect(doc['queuedForSeconds'], 0);
    });

    test('occurredAt is recorded either way', () {
      final raised = DateTime(2026, 8, 20, 21, 5);
      for (final queued in [true, false]) {
        final doc = _payload(capturedAt: raised).toFirestore(queued: queued);
        expect((doc['occurredAt'] as Timestamp).toDate(), raised);
      }
    });

    test('location is omitted rather than sent as nulls', () {
      expect(_payload().toFirestore(queued: false).containsKey('location'),
          isFalse);
      final located =
          _payload(lat: 1.5, lng: 2.5).toFirestore(queued: false);
      expect(located['location'], {'lat': 1.5, 'lng': 2.5});
    });
  });

  group('SosQueue', () {
    late Map<String, String> store;

    setUp(() async {
      store = {};
      _installFakeSecureStorage(store);
      await SosQueue.clear();
    });

    test('enqueue persists the alert before anything touches the network',
        () async {
      await SosQueue.enqueue(_payload(id: 'a'));
      final pending = await SosQueue.pending();
      expect(pending.map((e) => e.alertId), ['a']);
      expect(SosQueue.pendingCount.value, 1);
    });

    test('enqueueing the same alertId twice does not double-page security',
        () async {
      // The duplicate guard that makes every delivery path idempotent.
      await SosQueue.enqueue(_payload(id: 'a'));
      await SosQueue.enqueue(_payload(id: 'a'));
      expect((await SosQueue.pending()).length, 1);
    });

    test('remove clears only the delivered alert', () async {
      await SosQueue.enqueue(_payload(id: 'a'));
      await SosQueue.enqueue(_payload(id: 'b'));
      await SosQueue.remove('a');
      expect((await SosQueue.pending()).map((e) => e.alertId), ['b']);
      expect(SosQueue.pendingCount.value, 1);
    });

    test('concurrent enqueues do not lose an emergency to a race', () async {
      // Read-modify-write without the lock loses all but the last writer —
      // which for this queue means dropping an alert on the floor.
      await Future.wait([
        SosQueue.enqueue(_payload(id: 'a')),
        SosQueue.enqueue(_payload(id: 'b')),
        SosQueue.enqueue(_payload(id: 'c')),
      ]);
      expect((await SosQueue.pending()).map((e) => e.alertId).toSet(),
          {'a', 'b', 'c'});
    });

    test('recordAttempt increments without disturbing the payload', () async {
      await SosQueue.enqueue(_payload(id: 'a'));
      await SosQueue.recordAttempt('a');
      await SosQueue.recordAttempt('a');
      final item = (await SosQueue.pending()).single;
      expect(item.attempts, 2);
      expect(item.residentName, 'Maria Dela Cruz');
      expect(item.capturedAt, DateTime(2026, 8, 20, 21, 5));
    });

    test('a queue written by a previous run is readable after restart',
        () async {
      await SosQueue.enqueue(_payload(id: 'a'));
      // Same backing store, fresh read path — this is what boot does.
      _installFakeSecureStorage(store);
      expect((await SosQueue.pending()).map((e) => e.alertId), ['a']);
    });
  });

  group('SMS fallback body', () {
    test('leads with what a guard needs first', () {
      final body = _payload(lat: 14.12345, lng: 121.54321).toSmsBody();
      // Truncation happens from the back, so the order is the priority order.
      expect(body.indexOf('SOS Monticello Villas'), 0);
      expect(body.indexOf('Maria Dela Cruz'),
          lessThan(body.indexOf('Phase 2 • Block 7 • Lot 14')));
      expect(body.indexOf('Phase 2 • Block 7 • Lot 14'),
          lessThan(body.indexOf('14.12345')));
      expect(body, contains('at 21:05'));
      expect(body, contains('Ref uid_1700000000000'));
    });

    test('falls back to raw lot parts when no label was cached', () {
      final noLabel = SosPayload(
        alertId: 'x',
        residentUid: 'uid',
        residentName: '',
        residentPhone: '',
        propertyPhase: '3',
        propertyBlock: '1',
        propertyLot: '9',
        propertyLabel: null,
        capturedAt: DateTime(2026, 8, 20, 9, 7),
        emergencyType: 'general',
      );
      final body = noLabel.toSmsBody();
      expect(body, contains('Ph 3 Blk 1 Lot 9'));
      // An unknown name must not render as an empty field.
      expect(body, contains('Resident'));
      expect(body, contains('at 09:07'));
    });
  });
}