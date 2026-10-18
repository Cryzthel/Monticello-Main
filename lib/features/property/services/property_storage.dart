import 'package:cloud_firestore/cloud_firestore.dart';

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

  static final _firestore = FirebaseFirestore.instance;

  // In-memory cache of the last successfully loaded record per user. Screens
  // that need this data on open (Property Details, the home header's
  // greeting) can paint the cached value immediately instead of blocking on
  // a fresh Firestore round-trip every single time, then refresh silently
  // in the background via a normal [loadFullForUser] call.
  static final Map<String, PropertyRecord?> _cache = {};

  /// The last value [loadFullForUser] resolved for [uid], if any — `null`
  /// means "not yet fetched this session", not "no property on file" (a
  /// confirmed absence is still cached as `null` inside a wrapper the
  /// caller can't distinguish here, so callers should treat a cache miss
  /// the same as "unknown" and fall back to awaiting a fresh load).
  static PropertyRecord? cachedFor(String uid) => _cache[uid];

  /// Firestore may return numbers for legacy data; coerce for UI/consistency.
  static String? _coerceTrimmed(dynamic v) {
    if (v == null) return null;
    if (v is String) {
      final t = v.trim();
      return t.isEmpty ? null : t;
    }
    final s = v.toString().trim();
    return s.isEmpty ? null : s;
  }

  /// A property is "verified" exactly when it has a complete record —
  /// delegates to [loadFullForUser] instead of running its own separate
  /// Firestore query, so checking verification never costs a second
  /// round-trip for data the caller likely needs a moment later anyway.
  static Future<bool> isVerifiedForUser(String uid) async {
    return await loadFullForUser(uid) != null;
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


  /// This user's property record, live.
  ///
  /// ── WHY A STREAM EXISTS ALONGSIDE [loadFullForUser] ───────────────────────
  /// The resident cannot edit their own phase, block or lot any more — Property
  /// Details is a read-only record and the HOA office is the only writer. So
  /// the one place this document changes is the admin portal, and a one-shot
  /// `get()` meant a correction made there did not reach the handset until the
  /// app was killed: the home header kept greeting them at the wrong lot, and
  /// every incident filed from that session carried it.
  ///
  /// The cache is written from here too, so a screen that paints
  /// [cachedFor] on open and a screen that watches this stream cannot show two
  /// different addresses.
  static Stream<PropertyRecord?> watchForUser(String uid) {
    return _firestore.collection('properties').doc(uid).snapshots().map((doc) {
      final record = _recordFrom(doc.exists ? doc.data() : null);
      _cache[uid] = record;
      return record;
    });
  }

  /// The document → record mapping, shared by the one-shot read and the stream
  /// so they cannot disagree about what counts as a complete record.
  static PropertyRecord? _recordFrom(Map<String, dynamic>? data) {
    if (data == null) return null;
    final phase = _coerceTrimmed(data['phase']);
    final block = _coerceTrimmed(data['block']);
    final lot = _coerceTrimmed(data['lot']);
    // A partial record is not a property. Half an address in the header is
    // worse than the prompt to finish verification.
    if (phase == null || block == null || lot == null) return null;
    return PropertyRecord(
      phase: phase,
      block: block,
      lot: lot,
      street: data['street'] ?? '',
      unit: data['unit'] ?? '',
    );
  }

  static Future<PropertyRecord?> loadFullForUser(String uid) async {
    try {
      final doc = await _firestore.collection('properties').doc(uid).get();
      final record = _recordFrom(doc.exists ? doc.data() : null);
      _cache[uid] = record;
      return record;
    } catch (_) {
      // Transient error (offline, timeout, etc.) — fall back to the last
      // known value rather than forcing every caller's UI into an empty
      // "unverified" state on a blip.
      return _cache[uid];
    }
  }

  static Future<void> saveVerifiedProperty({
    required String uid,
    required String phase,
    required String block,
    required String lot,
    String street = '',
    String unit = '',
  }) async {
    await _firestore.collection('properties').doc(uid).set({
      'phase': phase,
      'block': block,
      'lot': lot,
      'street': street.trim(),
      'unit': unit.trim(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    // Awaited, together. These two were fire-and-forget, so a refused write
    // surfaced as an unhandled async error nobody could catch, and the
    // caller reported success before either had landed.
    await Future.wait([
      _firestore.collection('users').doc(uid).set({
        'block': block,
        'phase': phase,
        'lot': lot,
      }, SetOptions(merge: true)),
      // Keep the dashboard's resident-verification record (residents/{uid},
      // see AccountApprovalService) in step with the property a resident
      // just verified, so staff see the full address regardless of whether
      // this or markPending's write lands first (both merge, never overwrite).
      _firestore.collection('residents').doc(uid).set({
        'propertyPhase': phase,
        'propertyBlock': block,
        'propertyLot': lot,
        'propertyLabel': 'Phase $phase • Block $block • Lot $lot',
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true)),
    ]);

    // Keep the cache in step with what was just written, so the next
    // screen that reads this user's property sees it immediately rather
    // than a stale pre-save value until its own next fetch.
    _cache[uid] = PropertyRecord(
      phase: phase,
      block: block,
      lot: lot,
      street: street.trim(),
      unit: unit.trim(),
    );
  }

  static Future<void> clearIfUserMismatch(String? uid) async {
    // No-op with Firestore — data is keyed by uid
  }
}
