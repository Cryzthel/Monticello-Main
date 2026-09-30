import 'package:cloud_firestore/cloud_firestore.dart';

class AccountApprovalService {
  AccountApprovalService._();

  static final _db = FirebaseFirestore.instance;
  static final _collection = _db.collection('resident_accounts');

  static Future<void> markPending({
    required String uid,
    required String email,
    String source = 'email_password',
  }) async {
    await _collection.doc(uid).set({
      'uid': uid,
      'email': email,
      'status': 'pending',
      'source': source,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  static Future<bool> isApproved(String uid) async {
    final snap = await _collection.doc(uid).get();
    if (!snap.exists) return true;
    final data = snap.data();
    if (data == null) return true;
    final status = (data['status'] ?? '').toString().toLowerCase();
    return status == 'approved';
  }
}
