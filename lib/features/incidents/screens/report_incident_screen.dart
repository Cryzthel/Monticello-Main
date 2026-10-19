import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:cloud_firestore/cloud_firestore.dart' show DocumentReference;
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/features/property/services/property_storage.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';
import 'package:monticello_villas_app/features/auth/widgets/verification_lock.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/features/media/widgets/photo_evidence_dropzone.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';
import 'package:monticello_villas_app/features/map/widgets/incident_map_picker.dart';
import 'package:monticello_villas_app/features/incidents/widgets/location_selector_panel.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';
import 'package:monticello_villas_app/features/property/services/lot_reference_store.dart';
import 'package:monticello_villas_app/features/incidents/pin_placement.dart';

class ReportIncidentScreen extends StatefulWidget {
  const ReportIncidentScreen({super.key});

  @override
  State<ReportIncidentScreen> createState() => _ReportIncidentScreenState();
}

class _ReportIncidentScreenState extends State<ReportIncidentScreen>
    with SingleTickerProviderStateMixin {
  int _step = 0;

  String _category = 'Security';

  late LatLng _pin;

  /// Whether the pin has actually been put somewhere: dragged, set by
  /// "Locate me", or moved onto the chosen lot's surveyed centre.
  ///
  /// ── THE ESTATE-CENTRE REPORTS (2026-10-19) ─────────────────────────────
  /// [_pin] starts at the subdivision centre. Only the Phase/Block/Lot was
  /// required, so a report for a lot with no surveyed centre, filed without
  /// touching the map, went out pinned to the middle of the estate — and the
  /// guard's dispatch map drew it there, nowhere near the house it named.
  /// The location step now refuses to continue until this is true.
  bool _pinPlaced = false;
  final _descCtrl = TextEditingController();

  // ── Address: Phase, Block and Lot, chosen from the site plan ──
  //
  // The free-text street/landmark/gate field is gone: the location is the
  // three numbers a guard is dispatched to, each CHOSEN from the estate's real
  // schedule (see LocationEntryCard), so what reaches dispatch is an address
  // that exists. A typed landmark could not be checked and could name a phase
  // the estate does not have.

  /// The lot picked from [SubdivisionDirectory], or null while none is chosen.
  SubdivisionAddress? _address;

  /// The composed address written to the incident record.
  ///
  /// Kept as a controller so everything downstream — validation, the summary
  /// row, submit — still reads one location string and did not have to change.
  final _locationCtrl = TextEditingController();

  /// When the incident actually happened, which is not the same as when it is
  /// being filed.
  ///
  /// THE MANUAL TIME FIELD IS GONE. It existed because `reportedAt` used to be
  /// hardcoded to submit time, so a report written up an hour later sorted into
  /// the dispatch queue as if it had just happened. Asking the resident to
  /// confirm a clock time solved that but taxed every report to fix the
  /// minority that needed it.
  ///
  /// Evidence capture time replaces it: [_evidenceCapturedAt] takes the OLDEST
  /// timestamp across the attached photos and videos, which is when the
  /// resident was actually standing there with a camera out. With no evidence
  /// attached it falls back to submit time, which is what it always was.
  DateTime? _capturedAt;

  final List<XFile> _attachedPhotos = [];
  final List<XFile> _attachedVideos = [];
  bool _submitting = false;
  String? _locationError;
  String? _descError;
  String? _photoError;

  final _picker = ImagePicker();

  // Tracks combined byte progress across every evidence file uploading in
  // the background after submit, driving the success sheet's 3-stage
  // pending% -> check -> reveal sequence.
  final _evidenceUploadCtrl = StagedProgressController();
  final Map<String, int> _uploadedBytesByFile = {};
  final Map<String, int> _totalBytesByFile = {};

  void _reportUploadProgress(String key, int transferred, int total) {
    _uploadedBytesByFile[key] = transferred;
    _totalBytesByFile[key] = total;
    final totalAll = _totalBytesByFile.values.fold<int>(0, (a, b) => a + b);
    if (totalAll <= 0) return;
    final transferredAll =
        _uploadedBytesByFile.values.fold<int>(0, (a, b) => a + b);
    _evidenceUploadCtrl.updatePercent((transferredAll / totalAll * 100).clamp(0, 99));
  }

  // Upload guards — keep evidence small enough to upload quickly.
  static const int _maxPhotoBytes = 12 * 1024 * 1024; // 12 MB
  static const int _maxVideoBytes = 50 * 1024 * 1024; // 50 MB

  // Each accent is a distinct, saturated hue picked to stay clearly readable
  // against the app's near-black canvas — no two categories share a hue
  // family, so the color alone is enough to tell them apart at a glance.
  static const _categories = [
    _Category('Security', PhosphorIconsFill.shield, Color(0xFF6366F1),
        'Break-ins or suspicious activity'),
    _Category('Maintenance', PhosphorIconsFill.wrench, Color(0xFF3B82F6),
        'Repairs and upkeep issues'),
    _Category('Medical', PhosphorIconsFill.firstAidKit, Color(0xFFF43F5E),
        'Injuries or health emergencies'),
    // HAZARD IS GONE, and its removal is scoped deliberately.
    //
    // Removed from the PICKER, so no new report can be filed under it. NOT
    // removed from the display and scoring maps — `incident.dart`'s category
    // icon/colour switch, the web portal's `wpda.js` weights and
    // `badgeStyles.js` tones, and the Cloud Function's priority table all still
    // recognise `hazard`. Reports already stored under it would otherwise lose
    // their glyph, their colour and their triage weight, which is a data
    // problem dressed as a UI change.
    //
    // It also overlapped badly on the way in: "Unsafe conditions nearby" is
    // what a resident reaches for when nothing else fits, so it competed with
    // Other while genuine fires and floods — which have their own options —
    // were being filed under it.
    _Category('Fire', PhosphorIconsFill.fire,
        Color(0xFFF97316), 'Fire, smoke, or related danger'),
    _Category('Noise', PhosphorIconsFill.speakerHigh, Color(0xFFA855F7),
        'Excessive noise complaints'),
    // FLOODING IS GONE from the picker, on the same terms as Hazard above:
    // no new report can choose it, while `incident.dart` still renders a
    // stored 'flooding' report with its glyph and colour.
    _Category('Other', PhosphorIconsFill.warningOctagon, Color(0xFF94A3B8),
        'Anything else not listed'),
  ];

  /// The selected category's accent — the same hue its card carries on step 0,
  /// so the pin on step 1 is recognisably the thing that was just chosen.
  Color get _categoryColor => _categories
      .firstWhere(
        (c) => c.label == _category,
        orElse: () => _categories.last,
      )
      .color;

  /// Where the needle points while the map is moving, for the coordinate
  /// read-out. The picker writes it every camera frame; [_setPin] keeps it on
  /// the committed pin otherwise. A notifier so a drag repaints one line of
  /// text instead of this whole form.
  late final ValueNotifier<LatLng> _livePin;

  /// The reporter's registered lot line, read once. It was `_lotLine()` in
  /// build, so every pin commit started a new read and flashed the read-out
  /// back to "…".
  late final Future<String> _lotLineFuture = _lotLine();

  @override
  void initState() {
    super.initState();
    _pin = MapConstants.subdivisionCenter;
    _livePin = ValueNotifier<LatLng>(_pin);
  }

  /// Commits a pin to the form: what the report will file, and what the
  /// read-out shows. Call inside setState.
  void _setPin(LatLng next) {
    _pin = next;
    _pinPlaced = true;
    _livePin.value = next;
  }

  @override
  void dispose() {
    _livePin.dispose();
    _descCtrl.dispose();
    _locationCtrl.dispose();
    _evidenceUploadCtrl.dispose();
    super.dispose();
  }

  /// Step 0 (Select Category) always has a value — the category defaults to
  /// 'Security' and can only ever be reassigned to another option, never
  /// cleared — but the gate is kept explicit so every step follows the same
  /// validate-before-advance shape.
  bool _validateCategoryStep() => _category.isNotEmpty;

  /// The one location string the record carries: the chosen lot's label.
  String _composeLocation() => _address?.label ?? '';

  /// Step 1 (Pin Location) — both the address combos and the description live
  /// on this step, so both are validated together before advancing.
  bool _validateLocationStep() {
    bool valid = true;

    // A move still settling when Next is pressed — a fling's tail, or a drag
    // released a moment ago. The picker commits on idle, and leaving the step
    // unmounts it before that idle arrives, so the resident's last move would
    // be lost. [_livePin] only differs from [_pin] for a finger-driven move
    // (see IncidentMapPicker.liveCentre), so adopting it is adopting what the
    // resident did. Outside the estate it is not adopted: the picker would
    // have snapped it back.
    final live = _livePin.value;
    if (live != _pin && MapConstants.containsInSubdivision(live)) {
      setState(() => _setPin(live));
    }
    setState(() {
      _locationError = null;
      _descError = null;
    });

    _locationCtrl.text = _composeLocation();

    if (_address == null) {
      setState(() => _locationError = 'Choose the Phase, Block and Lot.');
      valid = false;
    } else if (!_pinPlaced) {
      // A fact, not a how-to (2026-10-19): the drag-and-Locate-me instruction
      // that stood here was removed by request. The map itself shows how.
      setState(() => _locationError = 'The pin is not on the map yet.');
      valid = false;
    }

    if (_descCtrl.text.trim().isEmpty) {
      setState(() => _descError = 'A detailed description is required.');
      valid = false;
    } else if (_descCtrl.text.trim().length < 10) {
      setState(() => _descError = 'Please provide more detail (at least 10 characters).');
      valid = false;
    }

    return valid;
  }

  /// Step 2 (Attach Evidence) — location/description are already guaranteed
  /// valid by the time the user reaches this step, so submit only re-checks
  /// what's actually entered here: photo evidence.
  bool _validateBeforeSubmit() {
    setState(() => _photoError = null);
    if (_attachedPhotos.isEmpty) {
      setState(() => _photoError = 'At least one photo is required as evidence.');
      return false;
    }
    return true;
  }

  void _next() {
    // The keyboard goes down before anything else happens: advancing with it
    // up leaves it covering the next step, and on the last step it would sit
    // over the success sheet the submit opens.
    FocusManager.instance.primaryFocus?.unfocus();
    switch (_step) {
      case 0:
        if (_validateCategoryStep()) setState(() => _step = 1);
        break;
      case 1:
        if (_validateLocationStep()) setState(() => _step = 2);
        break;
      default:
        if (_validateBeforeSubmit()) _submit();
    }
  }

  void _back() {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_step == 0) {
      Navigator.of(context).maybePop();
    } else {
      setState(() => _step--);
    }
  }

  Future<void> _pickMedia() async {
    ListTile tile(IconData icon, String label, String value) => ListTile(
          leading: Icon(icon, color: AppColors.primary),
          title: Text(label,
              style: sfPro(
                  color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
          onTap: () => Navigator.pop(context, value),
        );

    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.backgroundElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              tile(PhosphorIconsFill.camera, 'Take Photo', 'photo'),
              tile(PhosphorIconsFill.videoCamera, 'Record Video', 'video'),
            ],
          ),
        ),
      ),
    );
    if (choice == null) return;

    try {
      if (choice == 'photo') {
        // Downscale + compress on capture so photos upload in seconds.
        final picked = await _picker.pickImage(
          source: ImageSource.camera,
          maxWidth: 1600,
          maxHeight: 1600,
          imageQuality: 70,
        );
        if (picked == null || !mounted) return;
        if (!await _withinSizeLimit(picked, _maxPhotoBytes, 'Photo')) return;
        await _recordCaptureTime(picked);
        if (!mounted) return;
        setState(() {
          _attachedPhotos.add(picked);
          _photoError = null;
        });
      } else {
        // Cap clips at 60s to keep file sizes (and uploads) reasonable.
        final picked = await _picker.pickVideo(
          source: ImageSource.camera,
          maxDuration: const Duration(seconds: 60),
        );
        if (picked == null || !mounted) return;
        if (!await _withinSizeLimit(picked, _maxVideoBytes, 'Video')) return;
        await _recordCaptureTime(picked);
        if (!mounted) return;
        setState(() => _attachedVideos.add(picked));
      }
    } catch (_) {}
  }

  /// Binds the real capture time of a piece of evidence, keeping the earliest.
  ///
  /// This is what replaced the manual time field. The OLDEST attachment wins,
  /// because a resident who photographs the scene and then records a clip a
  /// minute later is reporting one event that started at the first shutter,
  /// not two events.
  ///
  /// `lastModified` is the file's own stamp from the camera, not the moment the
  /// form happened to read it. If the platform will not give one, the value is
  /// left alone and submit falls back to now — an approximate timestamp is
  /// worth more than a wrong one, and a wrong one here re-orders the dispatch
  /// queue.
  Future<void> _recordCaptureTime(XFile file) async {
    try {
      final stamp = await file.lastModified();
      final now = DateTime.now();
      // A camera clock set to the future would sort this report to the head of
      // the queue ahead of live emergencies.
      final bounded = stamp.isAfter(now) ? now : stamp;
      if (_capturedAt == null || bounded.isBefore(_capturedAt!)) {
        _capturedAt = bounded;
      }
    } catch (_) {
      // Leave _capturedAt as-is; submit falls back to DateTime.now().
    }
  }

  /// Rejects oversized attachments before they ever start uploading.
  Future<bool> _withinSizeLimit(XFile file, int maxBytes, String kind) async {
    final bytes = await File(file.path).length();
    if (bytes > maxBytes) {
      final mb = (bytes / (1024 * 1024)).toStringAsFixed(1);
      final maxMb = (maxBytes / (1024 * 1024)).toStringAsFixed(0);
      _toast(
        '$kind is too large (${mb}MB). Please keep it under ${maxMb}MB.',
        isError: true,
      );
      return false;
    }
    return true;
  }

  /// Explicit MIME type so uploads satisfy the Storage rules (which require an
  /// image/* or video/* content type — without this, putFile can default to
  /// application/octet-stream and the write is rejected).
  String _contentTypeFor(String name) {
    final n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.gif')) return 'image/gif';
    if (n.endsWith('.mp4')) return 'video/mp4';
    if (n.endsWith('.mov')) return 'video/quicktime';
    if (n.endsWith('.3gp')) return 'video/3gpp';
    if (n.endsWith('.mkv')) return 'video/x-matroska';
    if (n.endsWith('.avi')) return 'video/x-msvideo';
    return 'image/jpeg';
  }

  /// Uploads an attachment list to `incidents/{uid}/` in Cloud Storage and
  /// returns the resulting download URLs.
  Future<List<String>> _uploadAttachments(
    List<XFile> files, {
    required Duration timeout,
  }) async {
    if (files.isEmpty) return [];
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return [];

    final urls = <String>[];
    final storage = FirebaseStorage.instance;

    for (final file in files) {
      final ts = DateTime.now().millisecondsSinceEpoch;
      final key = '${ts}_${file.name}';
      final ref = storage
          .ref()
          .child('incidents')
          .child(user.uid)
          .child(key);
      // Declared outside the try so the failure path can still close it. The
      // cancel used to sit between the await and getDownloadURL, which meant it
      // was only ever reached when the upload SUCCEEDED: a timed-out or refused
      // file jumped straight to the catch and left this subscription attached
      // to a dead task for the life of the screen, still writing progress for
      // bytes that will never arrive.
      StreamSubscription<TaskSnapshot>? progressSub;
      try {
        final uploadTask = ref.putFile(
          File(file.path),
          SettableMetadata(contentType: _contentTypeFor(file.name)),
        );
        // `snapshotEvents` reports the task's failure AS A STREAM ERROR, and a
        // stream error with no `onError` is an unhandled asynchronous exception
        // — the catch below only guards the await, not the subscription. So a
        // resident on a weak signal saw the form recover correctly while the
        // console logged an uncaught firebase_storage error per dropped file.
        progressSub = uploadTask.snapshotEvents.listen(
          (snapshot) {
            _reportUploadProgress(key, snapshot.bytesTransferred, snapshot.totalBytes);
          },
          // The failure is already handled below, where it can be acted on.
          onError: (_) {},
        );
        await uploadTask.timeout(
          timeout,
          onTimeout: () => throw TimeoutException('Upload timed out'),
        );
        final url = await ref.getDownloadURL().timeout(
              const Duration(seconds: 20),
            );
        urls.add(url);
      } catch (_) {
        // One file failing is not the report failing: the rest still upload and
        // the submit continues with whatever landed.
      } finally {
        await progressSub?.cancel();
      }
    }
    return urls;
  }

  Future<List<String>> _uploadPhotos() =>
      _uploadAttachments(_attachedPhotos, timeout: const Duration(seconds: 30));

  Future<List<String>> _uploadVideos() =>
      _uploadAttachments(_attachedVideos, timeout: const Duration(seconds: 120));

  Future<void> _submit() async {
    HapticFeedback.mediumImpact();

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      _toast('Please sign in to submit a report.', isError: true);
      return;
    }

    // Verification is checked here rather than by gating the whole route, so
    // the form always opens instantly. Only a status we have actually OBSERVED
    // blocks the write: an unknown status (nothing cached because Firestore has
    // not been reachable) is allowed through to the server, where
    // firestore.rules refuses an unverified account's report
    // (isVerifiedResident, since 2026-10-19). Blocking on "we could not
    // check" would turn a connectivity problem into a permanent lockout.
    final known = AccountApprovalService.cachedStatusFor(user.uid);
    if (known != null && known != ResidentStatus.verified) {
      _toast(
        known == ResidentStatus.rejected
            ? 'Your account was not approved, so reports cannot be filed.'
            : 'Your account is still awaiting HOA verification.',
        isError: true,
      );
      return;
    }

    setState(() => _submitting = true);

    try {
      final prop = await PropertyStorage.loadForUser(user.uid).timeout(
        const Duration(seconds: 5),
        onTimeout: () => null,
      );
      final profile = UserProfileService.instance.profile;
      final reporterName = profile?.name ?? user.displayName ?? 'Resident';

      final incident = Incident(
        id: '',
        title: '$_category Report',
        category: _category,
        // ── WHERE THE INCIDENT IS, NOT WHERE THE REPORTER LIVES ────────────
        //
        // These three used to come only from [PropertyStorage] — the reporter's
        // own registered lot — so a resident reporting a break-in two streets
        // away filed it against their own address, and dispatch was sent to the
        // wrong house. The lot chosen on the location step wins; the registered
        // property stays as the fallback for a report that names only a
        // landmark.
        phase: _address?.phase ?? prop?.phase ?? '?',
        block: _address?.block.toString() ?? prop?.block ?? '?',
        lot: _address?.lot.toString() ?? prop?.lot ?? '?',
        description: _descCtrl.text.trim(),
        // Evidence capture time when there is evidence, submit time otherwise.
        // Dispatch orders its queue by this field, so it has to describe when
        // the incident happened rather than when the form was finished.
        reportedAt: _capturedAt ?? DateTime.now(),
        priority: _priorityForCategory(_category),
        status: IncidentStatus.pending,
        reporter: reporterName,
        reporterUid: user.uid,
        hasMedia: _attachedPhotos.isNotEmpty || _attachedVideos.isNotEmpty,
        photoUrls: const [],
        videoUrls: const [],
        latitude: _pin.latitude,
        longitude: _pin.longitude,
      );

      // Show the report at the top of History/dashboard the instant the
      // user hits submit — before the write even reaches Firestore — so
      // there's zero perceived latency. The placeholder is swapped for the
      // real synced document automatically once it lands (see
      // LocalDataStore._matchesOptimistic), or rolled back below on failure.
      LocalDataStore.instance.addIncidentOptimistic(incident);

      // ── THE ONE PLACE LOT COORDINATES ARE LEARNED ──────────────────────────
      //
      // Fires only when the lot being reported IS the reporter's own registered
      // one. The app already knows that address, so the pin they placed is an
      // unambiguous statement of where it sits — where a report filed against
      // any OTHER lot would be pinning a neighbour's house while naming
      // someone else's address, and would teach the table a wrong position.
      //
      // Device-local and never uploaded; see [LotReferenceStore]. This is what
      // makes the nearby-lot tags accumulate without a survey.
      final own = prop;
      final chosen = _address;
      if (own != null &&
          chosen != null &&
          chosen.phase == own.phase &&
          chosen.block.toString() == own.block &&
          chosen.lot.toString() == own.lot) {
        unawaited(LotReferenceStore.rememberOwnLot(chosen, _pin));
      }

      // ── ONE "UPLOADING…" STATE, THEN SUCCESS ─────────────────────────────
      //
      // The button shows an indeterminate "Uploading…" while the report is
      // written and any evidence is uploaded and patched onto it, and the
      // success sheet opens only once that is done — so "Report Filed
      // Successfully" means the database has it, evidence included. It used
      // to open at once with a percentage counter ticking underneath, which
      // claimed success before the evidence existed anywhere but this phone.
      //
      // Offline is not a failure: Firestore keeps the write and sends it when
      // the connection returns. The server acknowledgement is waited on for a
      // bounded time, and the sheet then says it will send, rather than
      // leaving the resident on a spinner in a dead zone.
      final hasMedia = _attachedPhotos.isNotEmpty || _attachedVideos.isNotEmpty;
      final docRefFuture = LocalDataStore.instance.addIncident(incident);

      DocumentReference? ref;
      try {
        ref = await docRefFuture.timeout(const Duration(seconds: 15));
      } on TimeoutException {
        ref = null; // queued on the device; Firestore sends it later
      } catch (_) {
        // Rejected outright (rules, a bad payload): roll the optimistic row
        // back rather than leave a ghost report that never reached the server.
        LocalDataStore.instance.clearOptimisticIncident();
        rethrow;
      }

      var evidenceFailed = false;
      if (hasMedia) {
        if (ref == null) {
          // Storage uploads need a connection the write did not get either.
          evidenceFailed = true;
        } else {
          _uploadedBytesByFile.clear();
          _totalBytesByFile.clear();
          _evidenceUploadCtrl.reset();
          try {
            final results =
                await Future.wait([_uploadPhotos(), _uploadVideos()]);
            final update = <String, dynamic>{'hasMedia': true};
            if (results[0].isNotEmpty) update['photoUrls'] = results[0];
            if (results[1].isNotEmpty) update['videoUrls'] = results[1];
            await ref.update(update);
          } catch (_) {
            evidenceFailed = true;
          }
        }
      }

      if (!mounted) return;
      setState(() => _submitting = false);
      _showSuccess(
        queuedOffline: ref == null,
        evidenceFailed: evidenceFailed,
      );
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        _toast('Failed to submit report. Please try again.', isError: true);
      }
    }
  }

  IncidentPriority _priorityForCategory(String category) {
    switch (category) {
      case 'Security':
      case 'Fire':
        return IncidentPriority.high;
      case 'Medical':
        return IncidentPriority.critical;
      // 'Hazard' was here too. Dropped with the picker option — this switch is
      // only ever reached with a value the picker produced, so a case for a
      // category that can no longer be selected is dead by construction.
      default:
        return IncidentPriority.medium;
    }
  }

  void _toast(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        content: Text(
          message,
          style: sfPro(
              fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white),
        ),
      ));
  }

  void _showSuccess({
    required bool queuedOffline,
    required bool evidenceFailed,
  }) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _SuccessSheet(
        category: _category,
        queuedOffline: queuedOffline,
        evidenceFailed: evidenceFailed,
        onDone: () {
          Navigator.of(context).pop();
          Navigator.of(context).pop();
        },
      ),
    );
  }

  /// A lot chosen in the location search, or the field being cleared.
  ///
  /// ── SELECTING AN ADDRESS MOVES THE PIN ────────────────────────────────────
  /// This used to be `setState(() => _address = a)` and nothing else, so the
  /// two halves of "where" could disagree: the badge above the pin read the lot
  /// the resident had just picked while the pin itself sat wherever the map had
  /// been left, and the coordinate actually filed was the second one. Picking a
  /// lot from the dropdown is the clearest statement of location this form
  /// receives — it should be the one that wins.
  ///
  /// The lookup can come back empty, and that is a normal outcome rather than a
  /// failure: [LotReferenceStore] is a survey of known lot centres plus points
  /// contributed by residents' own devices, so a lot nobody has stood in yet
  /// has no coordinate. The pin then stays exactly where it was. It is never
  /// moved to an approximation — a map that confidently drops the marker on the
  /// wrong house is worse than one that does not move.
  Future<void> _onAddressChanged(SubdivisionAddress? address) async {
    setState(() => _address = address);
    if (address == null) return;

    // Loaded lazily: the table is only read when something actually needs a
    // coordinate, and the map picker may not have touched it yet on a report
    // filed without dragging the map.
    if (!LotReferenceStore.isLoaded) await LotReferenceStore.load();
    final centre = LotReferenceStore.locator.centreFor(address);
    if (!mounted) return;
    // A pin the resident already put ON this lot is more exact than its
    // centroid, so it stays; see [pinAfterAddressPick].
    final next = pinAfterAddressPick(
      pin: _pin,
      placedByHand: _pinPlaced,
      lotCentre: centre,
    );
    if (next == null) return;
    // The picker watches `selected` and eases the camera across — see its
    // didUpdateWidget. Setting the pin here is the whole handoff.
    setState(() => _setPin(next));
  }

  Future<String> _lotLine() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return 'Not signed in';
    final prop = await PropertyStorage.loadForUser(user.uid);
    if (prop == null) return 'Complete property verification';
    return 'Phase ${prop.phase} • Block ${prop.block} • Lot ${prop.lot}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      // The "Continue" button and the map above it must stay fixed in
      // place when the keyboard opens for the description/location
      // fields — only the scrollable field area (inside _MapStep) should
      // resize to make room for the keyboard, via its own viewInsets-aware
      // padding below.
      resizeToAvoidBottomInset: false,
      // Tap past the fields to drop the keyboard, as on every form screen.
      body: DismissKeyboardOnTap(
        child: Container(
        decoration: const BoxDecoration(gradient: AppGradients.shell),
        child: SafeArea(
        // ── THE VERIFICATION GATE, IN CONTEXT ─────────────────────────────
        //
        // Wraps the CONTENT, never the route. `/report` is deliberately not
        // behind AccountVerificationGate (see the route table in app.dart):
        // that gate holds a blank screen until its first Firestore snapshot
        // lands, which on a slow connection is indistinguishable from a broken
        // app. This builder renders immediately and lets the lock settle onto
        // the form a frame later, so an unverified resident sees WHY they are
        // stopped instead of seeing nothing.
        child: VerificationStatusBuilder(
          builder: (context, status) {
            final locked = status.locksReporting;
            void showLockReason() =>
                showVerificationRequiredDialog(context, status);

            return Column(
          children: [
            _WizardHeader(
              step: _step,
              onBack: _back,
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 340),
                switchInCurve: Curves.fastOutSlowIn,
                switchOutCurve: Curves.fastOutSlowIn,
                transitionBuilder: (child, anim) => SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0.05, 0),
                    end: Offset.zero,
                  ).animate(anim),
                  child: FadeTransition(opacity: anim, child: child),
                ),
                child: _buildStep(status, showLockReason),
              ),
            ),
            _WizardFooter(
              step: _step,
              onNext: _next,
              submitting: _submitting,
              canProceed: !locked,
              // Disabled AND still answerable. A dead button teaches nothing;
              // this one looks inert, reads as inert to the semantics tree, and
              // still explains itself when pressed.
              onLockedTap: locked ? showLockReason : null,
            ),
          ],
        );
          },
        ),
        ),
      ),
      ),
    );
  }

  Widget _buildStep(ResidentVerification status, VoidCallback onLockedTap) {
    switch (_step) {
      case 0:
        return _CategoryStep(
          key: const ValueKey('cat'),
          categories: _categories,
          selected: _category,
          onSelected: (c) => setState(() => _category = c),
          status: status,
          onLockedTap: onLockedTap,
        );
      case 1:
        return _MapStep(
          key: const ValueKey('map'),
          pin: _pin,
          descCtrl: _descCtrl,
          address: _address,
          onAddressChanged: _onAddressChanged,
          lotLineFuture: _lotLineFuture,
          livePin: _livePin,
          onPinChanged: (ll) => setState(() => _setPin(ll)),
          locationError: _locationError,
          descError: _descError,
          // The pin takes the selected category's colour, so "what happened"
          // and "where" are one visual fact rather than two.
          categoryColor: _categoryColor,
        );
      case 2:
        return _MediaStep(
          key: const ValueKey('media'),
          category: _category,
          pin: _pin,
          descCtrl: _descCtrl,
          locationCtrl: _locationCtrl,
          attachedPhotos: _attachedPhotos,
          attachedVideos: _attachedVideos,
          onAddMedia: _pickMedia,
          onRemovePhoto: (i) => setState(() => _attachedPhotos.removeAt(i)),
          onRemoveVideo: (i) => setState(() => _attachedVideos.removeAt(i)),
          photoError: _photoError,
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

// ── Wizard Header with numbered step progress ────────────────────────────────

class _WizardHeader extends StatelessWidget {
  final int step;
  final VoidCallback onBack;

  const _WizardHeader({
    required this.step,
    required this.onBack,
  });

  // The per-step title and subtitle ("Attach Evidence" / "Add photos and
  // confirm details.") that sat under the progress bar were removed: they
  // repeated the step label directly above them and the button label below,
  // and cost ~50pt of a screen whose map and fields need it.

  @override
  Widget build(BuildContext context) {
    final labels = ['Category', 'Location', 'Evidence'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          // A Stack (rather than a Row) so the title is centered against
          // the full header width, not just the leftover space after the
          // back button and step counter — true AppBar-style centering
          // regardless of how wide either side element is.
          child: SizedBox(
            height: 44, // 44px minimum touch target for ModernBackButton
            child: Stack(
              alignment: Alignment.center,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: ModernBackButton(onPressed: onBack),
                ),
                // Prominent, static section label — what screen you're on —
                // separate from the per-step title further down, which
                // describes the *current step* rather than the section
                // itself.
                Text(
                  'Report Incident',
                  textAlign: TextAlign.center,
                  style: sfPro(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onGlassPrimary,
                    letterSpacing: -0.3,
                  ),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    'Step ${step + 1} of 3',
                    style: sfPro(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.onGlassSecondary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Numbered step indicators
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: List.generate(5, (i) {
              if (i.isOdd) {
                final segIdx = i ~/ 2;
                final segDone = step > segIdx;
                return Expanded(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 320),
                    curve: Curves.easeOutCubic,
                    height: 3,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      // Solid on both sides of the state. The unreached
                      // segment was a translucent hairline, which against a
                      // white surface is nearly invisible — leaving the nodes
                      // looking unconnected rather than "not there yet".
                      color: segDone
                          ? AppColors.accentPrimary
                          : AppColors.primarySoft,
                    ),
                  ),
                );
              }
              final idx = i ~/ 2;
              final isDone = step > idx;
              final isActive = step == idx;
              final isFilled = isDone || isActive;
              // FLAT. No shadow, no glow, no border.
              //
              // The active node used to carry an 8px emerald glow, which on the
              // old near-black shell read as emphasis and on a white one reads
              // as a smudge. State is carried entirely by fill and text colour
              // now: solid emerald with white numerals when reached, flat
              // slate-tinted surface with muted text when not.
              return AnimatedContainer(
                duration: const Duration(milliseconds: 320),
                curve: Curves.easeOutCubic,
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isFilled
                      ? AppColors.accentPrimary
                      : AppColors.primarySoft,
                ),
                child: Center(
                  child: isDone
                      ? const AnimatedCheckmark(
                          color: AppColors.onAccent, size: 16)
                      : Text(
                          '${idx + 1}',
                          style: sfPro(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: isActive
                                ? AppColors.onAccent
                                : AppColors.textMuted,
                          ),
                        ),
                ),
              );
            }),
          ),
        ),
        const SizedBox(height: 4),
        // Step labels
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: List.generate(3, (i) {
              final isActive = step == i;
              final isDone = step > i;
              return Expanded(
                child: Text(
                  labels[i],
                  textAlign: i == 0
                      ? TextAlign.left
                      : (i == 2 ? TextAlign.right : TextAlign.center),
                  style: sfPro(
                    fontSize: 13,
                    fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                    color: isDone || isActive
                        ? AppColors.onGlassPrimary
                        : AppColors.onGlassSecondary,
                  ),
                ),
              );
            }),
          ),
        ),
        const SizedBox(height: 4),
      ],
    );
  }
}

// ── Step layout ──────────────────────────────────────────────────────────────

/// The one frame every step's scroll body uses: 16px gutters, 12px below the
/// header, room at the foot above the footer. The three steps had drifted to
/// 6, 12 and 4px tops and 16px feet, so the content jumped vertically as the
/// resident moved between them.
const double _kStepGutter = 16;
const double _kStepTop = 12;
const double _kStepBottom = 24;

/// Space between stacked blocks inside a step.
const double _kStepGap = 12;

const EdgeInsets _kStepPadding =
    EdgeInsets.fromLTRB(_kStepGutter, _kStepTop, _kStepGutter, _kStepBottom);

// ── Category Step ────────────────────────────────────────────────────────────

class _CategoryStep extends StatelessWidget {
  final List<_Category> categories;
  final String selected;
  final ValueChanged<String> onSelected;
  final ResidentVerification status;
  final VoidCallback onLockedTap;

  const _CategoryStep({
    super.key,
    required this.categories,
    required this.selected,
    required this.onSelected,
    required this.status,
    required this.onLockedTap,
  });

  @override
  Widget build(BuildContext context) {
    final locked = status.locksReporting;

    // The banner is row ZERO of the list, not a fixed header above it. On a
    // six-card screen a pinned strip would permanently cost a card's worth of
    // height to say something a resident reads once.
    final leading = locked ? 1 : 0;

    // A single, full-width column of rows — reads as more premium and
    // structured than a cramped 2-column grid, and gives every category's
    // icon, name, and description room to breathe on their own line.
    return ListView.separated(
      padding: _kStepPadding,
      itemCount: categories.length + leading,
      separatorBuilder: (_, __) => const SizedBox(height: _kStepGap),
      itemBuilder: (context, index) {
        if (locked && index == 0) {
          return VerificationBanner(status: status, onTap: onLockedTap);
        }
        final cat = categories[index - leading];
        return _CategoryCard(
          category: cat,
          // No card shows as chosen while the list is locked. `_category`
          // defaults to Security, so without this one card would sit
          // emerald-bordered and ticked in a list nothing can be picked from.
          isSelected: !locked && cat.label == selected,
          locked: locked,
          onTap: () {
            if (locked) {
              onLockedTap();
              return;
            }
            HapticFeedback.selectionClick();
            onSelected(cat.label);
          },
        );
      },
    );
  }
}

class _CategoryCard extends StatefulWidget {
  final _Category category;
  final bool isSelected;
  final VoidCallback onTap;

  /// Renders the card inactive — `opacity-60`, a lock badge where the radio
  /// goes, and no press animation. It STILL takes the tap: [onTap] then opens
  /// the reason rather than doing nothing, because a card that swallows a touch
  /// silently is the same as a broken one.
  final bool locked;

  const _CategoryCard({
    required this.category,
    required this.isSelected,
    required this.onTap,
    this.locked = false,
  });

  @override
  State<_CategoryCard> createState() => _CategoryCardState();
}

class _CategoryCardState extends State<_CategoryCard> {
  bool _pressed = false;

  void _setPressed(bool value) {
    // Locked cards do not squish. The press animation says "this did
    // something"; here it did not.
    if (widget.locked) return;
    if (_pressed != value) setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final cat = widget.category;
    final isSelected = widget.isSelected;
    final locked = widget.locked;

    return GestureDetector(
      onTap: widget.onTap,
      // A brief, tactile press-down "squish" layered on top of the
      // selected-state color/border/shadow crossfade below — together
      // these make tapping a category feel like a single fluid gesture
      // rather than an instant state swap.
      onTapDown: (_) => _setPressed(true),
      onTapUp: (_) => _setPressed(false),
      onTapCancel: () => _setPressed(false),
      behavior: HitTestBehavior.opaque,
      // `opacity-60`. OUTSIDE the gesture detector's child chain but inside the
      // detector itself, so the card dims without becoming untappable — the tap
      // is what surfaces the explanation.
      child: Opacity(
        opacity: locked ? 0.6 : 1,
        child: AnimatedScale(
        scale: _pressed ? 0.97 : 1.0,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          // `p-4`, and symmetrical on all four sides — which is what makes the
          // trailing badge sit the same 16px off the right edge as the leading
          // icon tile sits off the left. Was 14, which was both off the 8px
          // grid and, once the badge moved to the trailing slot, the reason
          // the right side looked 2px tighter than the left.
          padding: const EdgeInsets.all(16),
          // `border-2 border-emerald-500 bg-emerald-50/20` selected,
          // `border border-slate-200 bg-white` at rest. Flat — no shadow, no
          // inner glow; the border does the work and the fill is a whisper.
          //
          // ONE EMERALD FOR SELECTION, not the category's own hue. The card
          // used to take `cat.color`, so a selected "Fire" framed itself amber
          // and "Theft" framed itself blue. That is deliberate here: selection
          // is the same fact on every card, and a state that changes colour by
          // row is a state you have to re-learn six times. Emerald means
          // "chosen" everywhere else in the app — the step bar, the submit
          // button — and now here too.
          //
          // The per-category hue has NOT been lost. It still owns the leading
          // icon tile just below, which is where it belongs: that is identity,
          // not state. And it still travels to the map pin on the next step,
          // so a Fire report is amber-pinned regardless of what colour the
          // card was while being picked.
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.accentPrimary.withValues(alpha: 0.05)
                : AppColors.backgroundSecondary,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(
              color: isSelected
                  ? AppColors.accentPrimary
                  // Slate, not the emerald hairline this carried. A resting
                  // card is chrome; only the chosen one earns brand colour.
                  : AppColors.borderNeutral,
              // ── 1.5px IN BOTH STATES ────────────────────────────────────
              //
              // Down from 2px selected / 1px at rest. At 2px on a 6-item list
              // the chosen card read as boxed-in rather than highlighted, and
              // the weight fought the 1.5px the form fields on the next step
              // use — the same screen, two different ideas of a border.
              //
              // Equal in both states is the part that does more than look
              // better. A border is drawn INSIDE the box, so 1px → 2px on
              // selection shrank the content area by 1px on every side: the
              // icon tile, the label and the badge all nudged inward the
              // instant you tapped, and back out when you picked another card.
              // A constant weight means selecting a category changes its
              // colour and nothing else. It also lets the AnimatedContainer
              // cross-fade purely on colour rather than re-laying-out.
              //
              // The trade: 1.5px emerald is a quieter selection cue than 2px
              // was. The 5% wash and the filled bullet are carrying more of
              // the signal now, which is why both stay.
              width: _FormField.borderWidth,
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color:
                      cat.color.withValues(alpha: isSelected ? 0.28 : 0.18),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(cat.icon, color: cat.color, size: 21),
              ),
              // 12, matching the gap on the far side of the text column. It
              // was 14 against the badge's 12, so the text block sat 2px
              // off-centre between the two flanking elements — invisible on
              // one card, a visible drift down a list of six.
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // The title owns this line by itself. The selection badge
                    // is in the outer Row's trailing slot, vertically centred
                    // against the whole card rather than pinned to this line.
                    Text(
                      cat.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: sfPro(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        // Does NOT change on selection. It used to become
                        // `cat.color`, which made sense while the whole card
                        // took that hue. With selection now emerald, a chosen
                        // "Fire" card would have read emerald border, emerald
                        // badge, amber title — three colours arguing about one
                        // state. The name is content; the border and the
                        // bullet are the state.
                        color: AppColors.onGlassPrimary,
                        letterSpacing: -0.1,
                      ),
                    ),
                    const SizedBox(height: 3),
                    // Two lines so the full micro-description is always
                    // readable instead of being cut off mid-word.
                    Text(
                      cat.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: sfPro(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w400,
                        color: AppColors.onGlassMuted,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              // ── The selection bullet, hard right and vertically centred ──
              //
              // Centred by the Row's CrossAxisAlignment.center against the
              // tallest child — the 44px icon tile, not the text — so it holds
              // the same optical line as that tile whether the description
              // wraps to one line or two. Pinning it to the title row instead
              // made it jump up 8px on any card whose description ran short.
              //
              // The Expanded text column above is what pushes it to the right
              // edge (`ml-auto`), and the badge is a fixed 24px in both
              // states, so nothing reflows when selection moves between cards.
              const SizedBox(width: 12),
              // The radio is replaced, not merely disabled. An empty ring on a
              // locked card still reads as "pick me"; a padlock does not.
              if (locked)
                const VerificationLockBadge()
              else
                _SelectedCheck(selected: isSelected),
            ],
          ),
        ),
        ),
      ),
    );
  }
}

/// The category card's selection bullet — a circular badge, filled when chosen.
///
/// ── IT IS A RADIO, AND IT NOW LOOKS LIKE ONE ──────────────────────────────
/// An empty ring that fills solid is the universal radio idiom, which is the
/// correct read here: category is single-select, so picking Fire un-picks
/// Theft. An earlier revision showed nothing at all when unselected, which
/// removed the one cue telling a resident these six cards are a *set of
/// options* rather than six independent things.
///
/// ── MATCHED TO THE STEP BAR, NOT MERELY SIMILAR ───────────────────────────
/// Filled state is the same `accentPrimary` disc and the same
/// [AnimatedCheckmark] the wizard's step indicator draws — literally the same
/// widget, not a lookalike rebuilt at a different size. Two components that
/// are supposed to match cannot drift if only one of them exists.
///
/// [AnimatedCheckmark] strokes itself on mount, which is what supplies the
/// selection animation: the disc scales in, and the tick draws inside it.
class _SelectedCheck extends StatelessWidget {
  const _SelectedCheck({required this.selected});

  final bool selected;

  /// `w-6 h-6`, and identical in both states.
  ///
  /// Equal size selected and unselected is not cosmetic. It sits in a Row
  /// beside an `Expanded` text column, so a badge that changed size would
  /// change how much width that column gets — and since the category label is
  /// `TextOverflow.ellipsis`, a long name would visibly re-truncate the
  /// instant you tapped it. A category must not change shape because you
  /// selected it.
  static const double _size = 24;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      width: _size,
      height: _size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        // Solid emerald when chosen; nothing but a ring when not. The fill and
        // the border cross-fade through AnimatedContainer, so the bullet
        // "inks in" rather than snapping.
        color: selected ? AppColors.accentPrimary : Colors.transparent,
        border: selected
            ? null
            : Border.all(color: AppColors.borderNeutralStrong, width: 2),
      ),
      child: Center(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          transitionBuilder: (child, animation) => FadeTransition(
            opacity: animation,
            child: ScaleTransition(
              scale: Tween<double>(begin: 0.6, end: 1.0).animate(
                CurvedAnimation(parent: animation, curve: Curves.easeOutBack),
              ),
              child: child,
            ),
          ),
          child: selected
              ? const AnimatedCheckmark(
                  key: ValueKey('checked'),
                  color: AppColors.onAccent,
                  size: 14,
                )
              : const SizedBox.shrink(key: ValueKey('unchecked')),
        ),
      ),
    );
  }
}

// ── Map Step: pin, address grid, description ─────────────────────────────────

/// Step 1 — pin the spot, then say where and what.
class _MapStep extends StatelessWidget {
  final LatLng pin;
  final TextEditingController descCtrl;
  final SubdivisionAddress? address;
  final ValueChanged<SubdivisionAddress?> onAddressChanged;
  final Future<String> lotLineFuture;
  final ValueNotifier<LatLng> livePin;
  final ValueChanged<LatLng> onPinChanged;
  final String? locationError;
  final String? descError;
  final Color categoryColor;

  const _MapStep({
    super.key,
    required this.pin,
    required this.descCtrl,
    required this.address,
    required this.onAddressChanged,
    required this.lotLineFuture,
    required this.livePin,
    required this.onPinChanged,
    required this.categoryColor,
    this.locationError,
    this.descError,
  });

  @override
  Widget build(BuildContext context) {
    // ── ONE SCROLL VIEW, TOP TO BOTTOM ──────────────────────────────────────
    //
    // The whole step is a single scrolling column: place card, map, lot card,
    // then the description. The map is back INSIDE the scroll view, which is
    // what lets the page scroll from the map header all the way down.
    //
    // The map claims drags that start on it — it is live from the first frame,
    // with no tap-to-activate step in front of the screen's primary action (see
    // IncidentMapPicker's "NO INTERACTION GATE" note). The column is laid out
    // so that costs nothing in practice: the address and description fields above
    // the map, the coordinate read-out below it, and the 16px gutters either
    // side of it are all ordinary scroll surface, and the map is only 240 of a
    // screen's worth of height. Pinning the map at the top instead had solved
    // the collision by making the map unscrollable-past, which is the complaint
    // this replaces.
    // No keyboard inset here: the footer lifts above the keyboard instead (see
    // _WizardFooter), which already shrinks this viewport by that height.
    return SingleChildScrollView(
      padding: _kStepPadding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. WHERE — both halves of the address, in one card above the map.
          //    Street/landmark/gate, then Phase/Block/Lot directly beneath it.
          //    They are one question and now sit together; splitting them
          //    across the map meant scrolling between two halves of one answer.
          LocationEntryCard(
            address: address,
            onAddressChanged: onAddressChanged,
            errorText: locationError,
          ),

          // 2. WHAT — directly under the address (2026-10-19, by request), so
          //    the two typed answers sit together and both labelled
          //    fields come before the map. It used to sit below the map,
          //    which split the form's text entry across the one control that
          //    cannot be scrolled past by dragging on it.
          //
          //    No time field. Evidence capture time is bound automatically
          //    when a photo or clip is attached on the next step — see
          //    _recordCaptureTime.
          const SizedBox(height: _kStepGap),
          _FormField(
            controller: descCtrl,
            label: 'Incident details',
            hint: 'Enter your incident details…',
            maxLines: 4,
          ),
          if (descError != null) ...[
            const SizedBox(height: 8),
            _InlineFieldError(message: descError!),
          ],

          // 3. THE MAP. Nothing floats over the imagery: the white address
          //    label that used to sit above the pin repeated the field
          //    above, and covered the spot being chosen.
          const SizedBox(height: _kStepGap),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: IncidentMapPicker(
              selected: pin,
              height: 240,
              // The pin, the hint glyph and the severity chip all take the
              // category's hue.
              radarColor: categoryColor,
              onChanged: onPinChanged,
              liveCentre: livePin,
            ),
          ),

          // 4. The coordinate the needle is on, following the drag.
          const SizedBox(height: _kStepGap),
          ValueListenableBuilder<LatLng>(
            valueListenable: livePin,
            builder: (_, live, __) =>
                _CoordinateReadout(pin: live, lotLineFuture: lotLineFuture),
          ),
        ],
      ),
    );
  }
}

/// Pin coordinates plus the resident's registered lot, above the address form.
class _CoordinateReadout extends StatelessWidget {
  const _CoordinateReadout({required this.pin, required this.lotLineFuture});

  final LatLng pin;
  final Future<String> lotLineFuture;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: AppColors.primarySoft,
        borderRadius: BorderRadius.circular(_FormField.radius),
        border: Border.all(color: AppColors.accentPrimary.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          const Icon(PhosphorIconsFill.navigationArrow,
              size: 15, color: AppColors.primaryDark),
          const SizedBox(width: 8),
          Text(
            '${pin.latitude.toStringAsFixed(5)}, '
            '${pin.longitude.toStringAsFixed(5)}',
            style: sfPro(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(width: 10),
          // Flexible, right-aligned: "Complete property verification" beside
          // a coordinate pair is wider than a 320pt phone, and the Spacer this
          // replaced let the pair overflow the pill instead of the label
          // giving way.
          Expanded(
            child: FutureBuilder<String>(
            future: lotLineFuture,
            builder: (_, snap) => Text(
              snap.data ?? '…',
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: sfPro(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryDark,
              ),
            ),
          ),
          ),
        ],
      ),
    );
  }
}

/// A labelled input with a permanently visible green border.
///
/// THE BORDER IS THE POINT. These fields used to be borderless tinted boxes
/// that only grew an outline on focus, so at rest the form read as a block of
/// grey slabs and there was nothing to tell a resident where one field ended
/// and the next began — least of all which were still empty. The resting
/// border is 1.5px emerald, and focus only DEEPENS that colour — no ring, no
/// glow, no elevation. (This doc said "adds a ring" for a while after the ring
/// was removed; see the note in [_BorderedInput] for why it went.)
///
/// This class is now mostly a LABEL plus the shared metric tokens. The input
/// itself is [_BorderedInput], which every field on the step renders through.
class _FormField extends StatelessWidget {
  const _FormField({
    required this.controller,
    required this.label,
    required this.hint,
    this.maxLines = 1,
  });

  final TextEditingController controller;
  final String label;
  final String hint;
  final int maxLines;

  // ── THE SHARED METRICS ────────────────────────────────────────────────────
  // Every number the form's inputs use lives here, and every field reads them.
  // Nothing below sets its own padding, height or border: a second copy of any
  // of these is how two fields that are supposed to match stop matching.

  // ── ALL FOUR NUMBERS NOW COME FROM AddressFieldStyle ──────────────────────
  //
  // The location panel and the description beneath it are the same
  // form, and they were drifting: 16px radius here against the panel's 12,
  // emerald borders here against the panel's slate. Delegating means the two
  // cannot disagree, and the aliases stay so the ~15 call sites below (and
  // _CategoryCard, and _CoordinateReadout) did not all have to be rewritten.

  /// `rounded-xl`. Was 16 — see AddressFieldStyle.radius.
  static const double radius = AddressFieldStyle.radius;

  /// `border-[1.5px]`. Down from 2px: at 2 the outline read as a heavy frame
  /// around every field and the form looked like a stack of boxes rather than
  /// a set of inputs.
  ///
  /// THE WHOLE SCREEN'S STROKE WEIGHT, not just the form's. The category cards
  /// on step 0 read this too — they had independently arrived at 2px and been
  /// walked down to 1.5 for the same reason, which is exactly the drift a
  /// shared constant exists to stop. Lives on [_FormField] only because that is
  /// where the screen's metric tokens already were.
  static const double borderWidth = AddressFieldStyle.borderWidth;

  @override
  Widget build(BuildContext context) {
    // The label lives INSIDE the field now and floats onto its border on
    // focus or once there is text — the Login page's pattern — instead of
    // sitting as a heading above the box.
    //
    // Rendered by the panel's AddressInput — the same widget as the Phase,
    // Block & Lot field above the map — so the two are one design.
    return AddressInput(
      controller: controller,
      hint: hint,
      label: label,
      maxLines: maxLines,
    );
  }
}

class _InlineFieldError extends StatelessWidget {
  final String message;

  const _InlineFieldError({required this.message});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Icon(PhosphorIconsFill.warningCircle,
            color: AppColors.danger, size: 14),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: sfPro(
              fontSize: 12,
              color: AppColors.danger,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

// ── Media Step with strict validation ────────────────────────────────────────

class _MediaStep extends StatelessWidget {
  final String category;
  final LatLng pin;
  final TextEditingController descCtrl;
  final TextEditingController locationCtrl;
  final List<XFile> attachedPhotos;
  final List<XFile> attachedVideos;
  final VoidCallback onAddMedia;
  final ValueChanged<int> onRemovePhoto;
  final ValueChanged<int> onRemoveVideo;
  final String? photoError;

  const _MediaStep({
    super.key,
    required this.category,
    required this.pin,
    required this.descCtrl,
    required this.locationCtrl,
    required this.attachedPhotos,
    required this.attachedVideos,
    required this.onAddMedia,
    required this.onRemovePhoto,
    required this.onRemoveVideo,
    this.photoError,
  });

  @override
  Widget build(BuildContext context) {
    final border = AppColors.glassBorderLight;
    final textSecondary = AppColors.onGlassSecondary;
    final timestamp =
        DateTime.now().toString().substring(0, 16).replaceAll('T', ' ');

    return ListView(
      padding: _kStepPadding,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.glassFill,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'REPORT SUMMARY',
                style: sfPro(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onGlassMuted,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 14),
              _SummaryRow(
                icon: PhosphorIconsFill.tag,
                label: 'Category',
                value: category,
              ),
              const SizedBox(height: 10),
              _SummaryRow(
                icon: PhosphorIconsFill.mapPin,
                label: 'Coordinates',
                value:
                    '${pin.latitude.toStringAsFixed(5)}, ${pin.longitude.toStringAsFixed(5)}',
              ),
              if (locationCtrl.text.isNotEmpty) ...[
                const SizedBox(height: 10),
                _SummaryRow(
                  icon: PhosphorIconsFill.mapPinSimple,
                  label: 'Location',
                  value: locationCtrl.text,
                ),
              ],
              if (descCtrl.text.isNotEmpty) ...[
                const SizedBox(height: 10),
                _SummaryRow(
                  icon: PhosphorIconsFill.notepad,
                  label: 'Description',
                  value: descCtrl.text,
                ),
              ],
            ],
          ),
        ),

        const SizedBox(height: 16),

        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.info.withValues(alpha: 0.20),
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: AppColors.info.withValues(alpha: 0.45)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(PhosphorIconsFill.sealCheck,
                  color: AppColors.info, size: 17),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Forensic Metadata Watermarking',
                      style: sfPro(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.onGlassPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'All attached media will be automatically watermarked with timestamp ($timestamp), GPS coordinates, and device ID for evidentiary integrity.',
                      style: sfPro(
                        fontSize: 12,
                        color: textSecondary,
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.glassFill,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(
              color: photoError != null
                  ? AppColors.danger.withValues(alpha: 0.50)
                  : border,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(PhosphorIconsFill.imagesSquare,
                      size: 16, color: AppColors.primaryDark),
                  const SizedBox(width: 8),
                  Text(
                    'Photo Evidence',
                    style: sfPro(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.onGlassPrimary,
                    ),
                  ),
                  // REQUIRED only until it is met — a red tag beside photos
                  // already attached reads as an error.
                  if (attachedPhotos.isEmpty && attachedVideos.isEmpty) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.danger.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      'REQUIRED',
                      style: sfPro(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: AppColors.danger,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  ],
                  const Spacer(),
                  if (attachedPhotos.isNotEmpty || attachedVideos.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.success.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(
                        '${attachedPhotos.length + attachedVideos.length} attached',
                        style: sfPro(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          // 11px on `success @ 12%` (#E3F4E9): the fill hue
                          // measures 2.89:1 there, the ink 6.24:1. This pill
                          // is the only confirmation that the photos actually
                          // attached, so it has to survive a glance.
                          color: AppColors.successInk,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 14),

              // ── ONE GRID FOR EVERYTHING ATTACHED ───────────────────────────
              // Photos, then videos, then an Add tile, three to a row. It was
              // a photo grid, a stack of video rows under it, and a full-width
              // Add button under those — three layouts for one list, with a
              // "Watermarked" strip printed on every thumbnail. The watermark
              // notice above the card says that once, for every file.
              if (attachedPhotos.isNotEmpty || attachedVideos.isNotEmpty)
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate:
                      const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    childAspectRatio: 1,
                  ),
                  itemCount: attachedPhotos.length + attachedVideos.length + 1,
                  itemBuilder: (_, i) {
                    if (i < attachedPhotos.length) {
                      return Stack(
                        fit: StackFit.expand,
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            child: Image.file(
                              File(attachedPhotos[i].path),
                              fit: BoxFit.cover,
                            ),
                          ),
                          // The shared remove control, with a 44pt target.
                          Positioned(
                            top: 0,
                            right: 0,
                            child: MediaRemoveButton(
                              semanticLabel: 'Remove photo ${i + 1}',
                              onTap: () => onRemovePhoto(i),
                            ),
                          ),
                        ],
                      );
                    }
                    final v = i - attachedPhotos.length;
                    if (v < attachedVideos.length) {
                      // No local thumbnail for a video, so a dark tile with a
                      // play glyph and its file name — same size, same
                      // corner, same remove control as a photo.
                      return Stack(
                        fit: StackFit.expand,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E293B),
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                            ),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(PhosphorIconsFill.playCircle,
                                    color: Colors.white, size: 26),
                                const SizedBox(height: 6),
                                Text(
                                  attachedVideos[v].name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: sfPro(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.white70,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Positioned(
                            top: 0,
                            right: 0,
                            child: MediaRemoveButton(
                              semanticLabel: 'Remove video ${v + 1}',
                              onTap: () => onRemoveVideo(v),
                            ),
                          ),
                        ],
                      );
                    }
                    // The Add tile, last in the grid where the next file goes.
                    return Semantics(
                      button: true,
                      label: 'Add photo or video',
                      excludeSemantics: true,
                      child: GestureDetector(
                        onTap: onAddMedia,
                        child: DashedOutline(
                          color: AppColors.primaryDark.withValues(alpha: 0.55),
                          radius: AppRadius.sm,
                          child: Container(
                            decoration: BoxDecoration(
                              color: AppColors.primaryDark.withValues(alpha: 0.05),
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                            ),
                            child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(PhosphorIconsFill.plusCircle,
                                  color: AppColors.primaryDark, size: 24),
                              const SizedBox(height: 4),
                              Text(
                                'Add',
                                style: sfPro(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.primaryDark,
                                ),
                              ),
                            ],
                          ),
                          ),
                        ),
                      ),
                    );
                  },
                )
              else
                PhotoEvidenceDropzone(
                  onTap: onAddMedia,
                  hasError: photoError != null,
                ),

              // Photo validation error
              if (photoError != null) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Icon(PhosphorIconsFill.warningCircle,
                        color: AppColors.danger, size: 14),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        photoError!,
                        style: sfPro(
                          fontSize: 12,
                          color: AppColors.danger,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _SummaryRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 15, color: AppColors.onGlassSecondary),
        const SizedBox(width: 10),
        // Expanded is the bound. Without it this column took its text's
        // intrinsic width, so a long description (or one unbroken string, a
        // pasted URL) ran straight out of the summary card.
        Expanded(
          child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: sfPro(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.onGlassMuted,
                letterSpacing: 0.4,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              softWrap: true,
              style: sfPro(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: AppColors.onGlassPrimary,
              ),
            ),
          ],
        ),
        ),
      ],
    );
  }
}

class _WizardFooter extends StatelessWidget {
  final int step;
  final VoidCallback onNext;
  final bool submitting;
  final bool canProceed;

  /// Non-null when the account is not verified. The button renders disabled but
  /// this still fires, so pressing it explains the lock.
  final VoidCallback? onLockedTap;

  const _WizardFooter({
    required this.step,
    required this.onNext,
    required this.submitting,
    required this.canProceed,
    this.onLockedTap,
  });

  @override
  Widget build(BuildContext context) {
    final locked = onLockedTap != null;
    final label = locked
        ? 'Verification required'
        : step == 2
            ? (submitting ? 'Submitting…' : 'Submit Report')
            : (step == 1 ? 'Continue to Evidence' : 'Continue to Map');

    // ── THE BUTTON RIDES ON TOP OF THE KEYBOARD ─────────────────────────────
    // The scaffold does not resize for the keyboard, so this footer used to
    // sit BEHIND it: a resident typing the incident details had no way to
    // press "Continue to Evidence" without first finding a spot to tap the
    // keyboard away. Lifting the footer by the keyboard's height keeps it
    // directly under the field being typed in, and because the step body is
    // the Expanded above it, the scroll area shrinks by the same amount — the
    // field stays in view without any extra inset of its own.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(
          20,
          10,
          20,
          keyboard > 0
              ? keyboard + 10
              : MediaQuery.of(context).padding.bottom + 14),
      // A disabled ElevatedButton builds an InkWell with every callback null,
      // which registers no gesture recognizer at all — so the tap falls through
      // to this detector. That is what lets the button be genuinely disabled
      // for the semantics tree and still answer when pressed.
      child: GestureDetector(
        onTap: onLockedTap,
        behavior: HitTestBehavior.opaque,
        child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          // Neutral. Was emerald at 35% — the heaviest green glow in the app,
          // under the widest button in the app. The shadow still appears only
          // when the step can be advanced, so it keeps carrying "this is live"
          // without carrying the brand hue a second time.
          boxShadow: canProceed && !submitting ? AppShadows.md : const [],
        ),
        child: SizedBox(
          width: double.infinity,
          height: 54,
          child: ElevatedButton(
            onPressed: canProceed && !submitting ? onNext : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              disabledBackgroundColor:
                  AppColors.primary.withValues(alpha: 0.38),
              foregroundColor: AppColors.background,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
            child: submitting
                // Indeterminate, with words: the app's one spinner and what it
                // is waiting on. No percentage — byte counts across several
                // files jump around and stall at 99%, which reads as broken.
                ? Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const LeafLoader(size: 18, color: AppColors.background),
                      const SizedBox(width: 10),
                      Text(
                        'Uploading…',
                        style: sfPro(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.background,
                        ),
                      ),
                    ],
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (locked) ...[
                        const Icon(PhosphorIconsFill.lockSimple,
                            size: 15, color: AppColors.background),
                        const SizedBox(width: 8),
                      ],
                      Flexible(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: sfPro(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: AppColors.background,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
        ),
        ),
      ),
    );
  }
}

class _SuccessSheet extends StatelessWidget {
  final String category;

  /// The write is on the device but the server has not confirmed it yet.
  final bool queuedOffline;

  /// The report is filed, but its photos or videos did not upload.
  final bool evidenceFailed;
  final VoidCallback onDone;

  const _SuccessSheet({
    required this.category,
    required this.queuedOffline,
    required this.evidenceFailed,
    required this.onDone,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.xl),
        boxShadow: const [
          BoxShadow(
            color: AppColors.glassShadow,
            blurRadius: 20,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.xl),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Container(
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              gradient: AppGradients.shell,
              borderRadius: BorderRadius.circular(AppRadius.xl),
              border: Border.all(color: AppColors.glassBorderLight),
            ),
            child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.success.withValues(alpha: 0.14),
              border: Border.all(
                  color: AppColors.success.withValues(alpha: 0.40), width: 2),
            ),
            child: const Icon(PhosphorIconsFill.check,
                color: AppColors.success, size: 36),
          ),
          const SizedBox(height: 18),
          Text(
            'Report Filed Successfully',
            style: sfPro(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: AppColors.onGlassPrimary,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Your $category report has been logged, timestamped, and routed to HOA security. You can track its status in My Incidents.',
            textAlign: TextAlign.center,
            style: sfPro(
              fontSize: 13.5,
              color: AppColors.onGlassSecondary,
              height: 1.5,
            ),
          ),
          // Only when something is not as the headline implies — a clean
          // filing needs no second line saying so.
          if (queuedOffline || evidenceFailed) ...[
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(
                    color: AppColors.warning.withValues(alpha: 0.30)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    queuedOffline
                        ? PhosphorIconsFill.cloudSlash
                        : PhosphorIconsFill.warningCircle,
                    size: 18,
                    color: AppColors.warningInk,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      queuedOffline
                          ? 'Saved on this phone. It will send automatically '
                              'when you are back online'
                              '${evidenceFailed ? ' — attach evidence again '
                                  'from My Incidents once it has.' : '.'}'
                          : 'Your photos or videos could not be uploaded. '
                              'The report was filed without them.',
                      style: sfPro(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.warningInk,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 54,
            child: ElevatedButton(
              onPressed: onDone,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.background,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              child: Text(
                'Back to Dashboard',
                style: sfPro(
                    fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Category {
  final String label;
  final IconData icon;
  final Color color;
  final String description;
  const _Category(this.label, this.icon, this.color, this.description);
}
