import 'package:shared_preferences/shared_preferences.dart';

const _kVerifiedUid = 'monticello_verified_uid';
const _kPhase = 'monticello_phase';
const _kBlock = 'monticello_block';
const _kLot = 'monticello_lot';
const _kStreet = 'monticello_street';
const _kUnit = 'monticello_unit';

/// Full persisted property snapshot for UI (optional fields default to empty).
class PropertyRecord {
  final String phase;
  final String block;
  final String lot;
  final String street;
  final String unit;

  const PropertyRecord({
    required this.phase,
    required this.block,
    required this.lot,
    this.street = '',
    this.unit = '',
  });
}

class PropertyStorage {
  PropertyStorage._();

  static Future<bool> isVerifiedForUser(String uid) async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kVerifiedUid) == uid &&
        p.getString(_kPhase) != null &&
        p.getString(_kBlock) != null &&
        p.getString(_kLot) != null;
  }

  static Future<({String phase, String block, String lot})?> loadForUser(
    String uid,
  ) async {
    final record = await loadFullForUser(uid);
    if (record == null) return null;
    return (
      phase: record.phase,
      block: record.block,
      lot: record.lot,
    );
  }

  static Future<PropertyRecord?> loadFullForUser(String uid) async {
    final p = await SharedPreferences.getInstance();
    if (p.getString(_kVerifiedUid) != uid) return null;
    final phase = p.getString(_kPhase);
    final block = p.getString(_kBlock);
    final lot = p.getString(_kLot);
    if (phase == null || block == null || lot == null) return null;
    return PropertyRecord(
      phase: phase,
      block: block,
      lot: lot,
      street: p.getString(_kStreet) ?? '',
      unit: p.getString(_kUnit) ?? '',
    );
  }

  static Future<void> saveVerifiedProperty({
    required String uid,
    required String phase,
    required String block,
    required String lot,
    String street = '',
    String unit = '',
  }) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kVerifiedUid, uid);
    await p.setString(_kPhase, phase);
    await p.setString(_kBlock, block);
    await p.setString(_kLot, lot);
    await p.setString(_kStreet, street.trim());
    await p.setString(_kUnit, unit.trim());
  }

  static Future<void> clearIfUserMismatch(String? uid) async {
    if (uid == null) return;
    final p = await SharedPreferences.getInstance();
    final stored = p.getString(_kVerifiedUid);
    if (stored != null && stored != uid) {
      await p.remove(_kVerifiedUid);
      await p.remove(_kPhase);
      await p.remove(_kBlock);
      await p.remove(_kLot);
      await p.remove(_kStreet);
      await p.remove(_kUnit);
    }
  }
}
