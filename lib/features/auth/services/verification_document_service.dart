import 'dart:async';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

/// What registration accepts as an HOA ID / proof of residency, and why a
/// file was refused.
///
/// Pure, so the rules are unit-tested without a picker or a bucket. The size
/// cap is the one storage.rules enforces on `verification_ids/` (under 10 MB);
/// checking it here first means an oversized photo is refused on the form with
/// a reason, instead of after a failed upload on estate mobile data.
class VerificationIdRules {
  VerificationIdRules._();

  /// storage.rules: `request.resource.size < 10 * 1024 * 1024`.
  static const int maxBytes = 10 * 1024 * 1024;

  /// Extension → content type.
  ///
  /// HEIC is deliberately absent. It passes the storage rule (`image/.*`), but
  /// the admin portal shows the ID in a browser `<img>`, and Chrome cannot
  /// decode HEIC — staff would get a broken image to verify. The picker asks
  /// for a resized JPEG, which iOS honours by converting, so an iPhone photo
  /// arrives as `.jpg` and never meets this refusal in practice.
  ///
  /// PDF is here because proof of residency is often not a photo at all: a
  /// lease, a title or a utility bill arrives as a PDF. storage.rules allows
  /// `application/pdf` on `verification_ids/` for the same reason, and the
  /// admin drawer opens one in a new tab instead of an image lightbox.
  ///
  /// WebP is accepted but not advertised: some Android galleries hand one
  /// back, and refusing a legitimate photo over its container would be worse
  /// than a label that lists only the common three.
  static const Map<String, String> contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
  };

  static bool isPdf(String path) => extensionOf(path) == 'pdf';

  /// Shown under the upload card, so the resident knows the limits before
  /// picking rather than after being refused.
  static const String requirementsLabel = 'JPG, PNG, or PDF up to 10MB';

  static String extensionOf(String path) {
    final name = path.split(RegExp(r'[\\/]')).last;
    final dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.substring(dot + 1).toLowerCase();
  }

  static String? contentTypeFor(String path) => contentTypes[extensionOf(path)];

  /// Null when the file is acceptable; otherwise the sentence to show.
  static String? validate({required String path, required int bytes}) {
    if (contentTypeFor(path) == null) {
      return 'Use a JPG, PNG, or PDF file.';
    }
    if (bytes <= 0) return 'That file could not be read. Try another.';
    if (bytes >= maxBytes) {
      return 'That file is ${formatSize(bytes)}. The limit is 10 MB.';
    }
    return null;
  }

  /// "840 KB", "2.4 MB".
  static String formatSize(int bytes) {
    if (bytes < 1024 * 1024) {
      final kb = (bytes / 1024).ceil();
      return '$kb KB';
    }
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

/// Uploads the government ID an applicant submits at registration.
///
/// Files land in `verification_ids/{uid}/...`, which storage.rules restricts
/// to the uploader plus approved staff — deliberately narrower than the
/// `incidents/` and `profile_photos/` folders, which any signed-in resident
/// may read.
class VerificationDocumentService {
  VerificationDocumentService._();

  static final _storage = FirebaseStorage.instance;
  static final _residents = FirebaseFirestore.instance.collection('residents');

  /// Returns the download URL, or `null` if the upload failed.
  ///
  /// Registration treats null as a stop: the ID is mandatory, so the form stays
  /// open with the upload marked failed and the button offering a retry. The
  /// account itself already exists at that point and is not rolled back.
  ///
  /// [onProgress] receives 0..1 as bytes go up, for the card's progress bar.
  static Future<String?> uploadId({
    required String uid,
    required File file,
    void Function(double fraction)? onProgress,
  }) async {
    final contentType = VerificationIdRules.contentTypeFor(file.path);
    if (contentType == null) return null;
    StreamSubscription<TaskSnapshot>? progress;
    try {
      final ext = VerificationIdRules.extensionOf(file.path);
      final name = 'id_${DateTime.now().millisecondsSinceEpoch}.$ext';
      final ref = _storage.ref().child('verification_ids/$uid/$name');
      // The real type, not a hardcoded image/jpeg: a PNG labelled as a JPEG
      // still passes the `image/.*` rule but is served with the wrong header,
      // and a PDF labelled as one fails the rule outright.
      final task =
          ref.putFile(file, SettableMetadata(contentType: contentType));
      if (onProgress != null) {
        progress = task.snapshotEvents.listen((snap) {
          if (snap.totalBytes > 0) {
            onProgress(snap.bytesTransferred / snap.totalBytes);
          }
        }, onError: (_) {});
      }
      await task;
      return await ref.getDownloadURL();
    } catch (_) {
      return null;
    } finally {
      await progress?.cancel();
    }
  }

  /// Attaches an uploaded ID to the record staff review.
  ///
  /// `documentUrls` is the field the admin portal's Resident Review drawer
  /// already renders (see web-portal/packages/shared/src/lib/residents.js), so
  /// the photo appears there with no portal change. `arrayUnion`, so a retried
  /// upload adds to the list rather than replacing it.
  ///
  /// The owner-update rule on `residents/{uid}` allows this: it changes no
  /// `verificationStatus`.
  static Future<void> attachToResident({
    required String uid,
    required String url,
  }) {
    return _residents.doc(uid).set({
      'documentUrls': FieldValue.arrayUnion([url]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}
