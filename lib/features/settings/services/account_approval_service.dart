import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Canonical `verificationStatus` wire values stored in `residents/{uid}`.
///
/// These previously drifted: [AccountApprovalService.isApproved] compared
/// against `'verified'` while the home screen compared against `'approved'`,
/// so the two could never agree — a resident the service considered approved
/// still rendered an "Unverified" badge. Everything now reads these
/// constants instead of inline string literals.
class ResidentStatus {
  ResidentStatus._();

  static const pending = 'pending';
  static const verified = 'verified';
  static const rejected = 'rejected';
}

/// Whether the applicant owns the property or rents it. Stored as a plain
/// wire string on `residents/{uid}.residentType` and rendered verbatim by the
/// admin dashboard, so these values must stay stable.
class ResidentType {
  ResidentType._();

  static const homeowner = 'homeowner';
  static const tenant = 'tenant';

  static const all = [homeowner, tenant];

  static String label(String value) {
    switch (value) {
      case tenant:
        return 'Tenant';
      case homeowner:
        return 'Homeowner';
      default:
        return 'Unspecified';
    }
  }
}

/// Resident verification lives in `residents/{uid}` — the same collection
/// and `verificationStatus` field the admin dashboard's Residents module
/// reads and writes. Keeping both sides on one collection means an account a
/// resident signs up for on mobile is the same doc staff verify on the
/// dashboard, instead of two disconnected records that never sync.
class AccountApprovalService {
  AccountApprovalService._();

  static final _db = FirebaseFirestore.instance;
  static final _collection = _db.collection('residents');

  static Future<void> markPending({
    required String uid,
    required String email,
    String? name,
    String? phone,
    String? phase,
    String? block,
    String? lot,
    String? residentType,
    // emergencyContactName / emergencyContactNumber / documentUrls were here.
    // Registration no longer collects any of them: proof of residency is the
    // HOA office's step, after the account exists. Existing resident documents
    // are untouched — this only stops NEW writes, and `set(merge: true)` never
    // clears a field it is not given.
    String source = 'email_password',
  }) async {
    await _collection.doc(uid).set({
      'uid': uid,
      'email': email,
      if (name != null && name.isNotEmpty) 'name': name,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (residentType != null && residentType.isNotEmpty)
        'residentType': residentType,
      // Property details are what the admin actually checks the application
      // against, so they belong on the record staff review — not only on the
      // separate `properties/{uid}` doc the resident owns.
      if (phase != null && phase.isNotEmpty) 'phase': phase,
      if (block != null && block.isNotEmpty) 'block': block,
      if (lot != null && lot.isNotEmpty) 'lot': lot,
      'verificationStatus': ResidentStatus.pending,
      'source': source,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  /// Self-heal for a missing review record.
  ///
  /// Signup calls [markPending] inside a `catch (_) {}`, so a transient
  /// failure there leaves an authenticated resident with no `residents/{uid}`
  /// doc. Because the verification gate treats "no doc" as pending, that
  /// resident would be locked out *permanently* — and staff would have
  /// nothing in the queue to approve, since the record never existed. Calling
  /// this when the gate mounts guarantees anyone who reaches the locked
  /// screen is actually visible to an admin.
  ///
  /// Safe to call repeatedly: it only writes when the doc is genuinely
  /// absent, so it can never reset an already-reviewed status back to
  /// pending. Firestore rules permit a resident to create their own record
  /// (`allow create: if isOwner(userId)`), but not to change its status.
  static Future<void> ensureRecordExists() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    try {
      final snap = await _collection.doc(user.uid).get();
      // A doc can exist yet carry NO verificationStatus — PropertyStorage
      // .saveVerifiedProperty writes only property fields, so it can create
      // the record on its own. Such a resident is stuck with no reviewable
      // status, so heal that case too rather than only a fully-missing doc.
      final hasStatus =
          snap.exists && (snap.data()?['verificationStatus'] != null);
      if (hasStatus) return;
      await markPending(
        uid: user.uid,
        email: user.email ?? '',
        name: user.displayName,
        source: 'self_heal',
      );
    } catch (_) {
      // Offline or rules-blocked — the gate stays on the pending screen,
      // which is the safe outcome.
    }
  }

  /// Last status actually observed, keyed by uid.
  ///
  /// WHY THIS EXISTS. Every gated route wraps its screen in its own
  /// [AccountVerificationGate], and each gate opens its own `statusStream`
  /// subscription when it mounts. A Firestore snapshot listener emits nothing
  /// until its first snapshot arrives, so *navigating* to a gated route put the
  /// resident back on the gate's holding screen — even though the gate around
  /// the home screen had already resolved this exact status at launch.
  ///
  /// On a healthy connection that is a flicker. When Firestore cannot be
  /// reached at all it never resolves, and `snapshots()` does not error in that
  /// case — it waits. The result is a gated route that renders the holding
  /// screen indefinitely while the ungated ones work perfectly, which reads as
  /// "this one page is broken" rather than "the app cannot reach the server".
  ///
  /// Seeding the next gate with what the last one saw removes the re-block.
  /// It is a cache of an observation, not an authority: the live stream still
  /// runs, and the first real snapshot overrides this — so a revoked approval
  /// still takes effect the moment Firestore reports it.
  static String? _cachedUid;
  static String? _cachedStatus;

  /// The last observed status for [uid], or null if nothing has been seen for
  /// this account yet. Keyed by uid so one resident can never be handed
  /// another's cached verdict after a switch of account.
  static String? cachedStatusFor(String uid) =>
      _cachedUid == uid ? _cachedStatus : null;

  /// Called on sign-out so the next account starts from a clean slate.
  static void clearStatusCache() {
    _cachedUid = null;
    _cachedStatus = null;
  }

  /// Live status feed. The app previously only ever read this once via
  /// [getStatus], which meant an admin approval didn't reach the resident
  /// until they killed and relaunched the app. Listening keeps the gate
  /// reactive so the transition happens the moment staff act.
  static Stream<String> statusStream(String uid) {
    return _collection.doc(uid).snapshots().map((snap) {
      final data = snap.data();
      final status = (!snap.exists || data == null)
          ? ResidentStatus.pending
          : (data['verificationStatus'] ?? ResidentStatus.pending)
              .toString()
              .toLowerCase();
      _cachedUid = uid;
      _cachedStatus = status;
      return status;
    });
  }

  /// Reason supplied by the admin when an application is rejected, so the
  /// resident sees *why* rather than a dead end.
  static Stream<String?> rejectionReasonStream(String uid) {
    return _collection.doc(uid).snapshots().map((snap) {
      final reason = snap.data()?['rejectionReason'];
      final text = reason?.toString().trim() ?? '';
      return text.isEmpty ? null : text;
    });
  }

  /// Homeowner or tenant, as the applicant declared it at sign-up. Null when
  /// the record predates the field. Firestore shares one listener per
  /// document, so this beside [statusStream] costs no second connection.
  static Stream<String?> residentTypeStream(String uid) {
    return _collection.doc(uid).snapshots().map((snap) {
      final raw = snap.data()?['residentType']?.toString().trim() ?? '';
      return ResidentType.all.contains(raw) ? raw : null;
    });
  }

  static Future<bool> isApproved(String uid) async {
    final status = await getStatus(uid);
    return status == ResidentStatus.verified;
  }

  static Future<String> getStatus(String uid) async {
    try {
      final snap = await _collection.doc(uid).get();
      if (!snap.exists) return ResidentStatus.pending;
      final data = snap.data();
      if (data == null) return ResidentStatus.pending;
      return (data['verificationStatus'] ?? ResidentStatus.pending)
          .toString()
          .toLowerCase();
    } catch (_) {
      return ResidentStatus.pending;
    }
  }
}
