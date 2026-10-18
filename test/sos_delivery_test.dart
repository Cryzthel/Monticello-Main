import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/features/panic_button/services/sos_sync_service.dart';

/// The delivery decision behind every SOS write: the first attempt and every
/// retry from the queue. See [SosSyncService.deliverWith].
///
/// Permission-denied is the case that matters. firestore.rules lets only a
/// verified resident CREATE an alert, and only security staff UPDATE one, so
/// a refused `set` means either "this account may not raise alerts" (final:
/// drop it, lock the sheet) or "the alert already landed" (delivered). One
/// read tells them apart; anything short of an explicit answer stays pending.
void main() {
  const timeout = Duration(seconds: 1);
  FirebaseException denied() =>
      FirebaseException(plugin: 'cloud_firestore', code: 'permission-denied');
  FirebaseException unavailable() =>
      FirebaseException(plugin: 'cloud_firestore', code: 'unavailable');

  Future<SosDelivery> run({
    required Future<void> Function() write,
    Future<bool> Function()? exists,
  }) =>
      SosSyncService.deliverWith(
        alertId: 'uid_1',
        write: write,
        exists: exists ?? () async => fail('should not have been asked'),
        timeout: timeout,
      );

  test('an acknowledged write is delivered', () async {
    expect(await run(write: () async {}), SosDelivery.delivered);
  });

  test('no acknowledgement in time is pending, not refused', () async {
    final result = await run(write: () => Completer<void>().future);
    expect(result, SosDelivery.pending);
  });

  test('a server error other than a refusal is pending', () async {
    expect(await run(write: () async => throw unavailable()),
        SosDelivery.pending);
  });

  test('refused, and the read is refused too: the account may not raise one',
      () async {
    final result = await run(
      write: () async => throw denied(),
      exists: () async => throw denied(),
    );
    expect(result, SosDelivery.refused);
  });

  test('refused, but the alert is there: it landed earlier', () async {
    // The `set` was an UPDATE of an alert that already exists, which only
    // security staff may make. Nothing was overwritten, and it is delivered.
    final result = await run(
      write: () async => throw denied(),
      exists: () async => true,
    );
    expect(result, SosDelivery.delivered);
  });

  test('refused, and the server confirms nothing is there', () async {
    final result = await run(
      write: () async => throw denied(),
      exists: () async => false,
    );
    expect(result, SosDelivery.refused);
  });

  test('refused, but the follow-up read cannot be made: pending', () async {
    // Not final. Dropping an emergency from the queue needs an explicit no.
    final offline = await run(
      write: () async => throw denied(),
      exists: () async => throw unavailable(),
    );
    expect(offline, SosDelivery.pending);

    final slow = await run(
      write: () async => throw denied(),
      exists: () => Completer<bool>().future,
    );
    expect(slow, SosDelivery.pending);
  });
}
