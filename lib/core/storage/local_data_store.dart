import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';

import 'package:monticello_villas_app/core/network/request_pace.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

class LocalDataStore extends ChangeNotifier {
  LocalDataStore._internal();
  static final LocalDataStore instance = LocalDataStore._internal();

  final _firestore = FirebaseFirestore.instance;

  List<Incident> _incidents = [];
  List<Announcement> _announcements = [];

  StreamSubscription? _incidentsSub;
  StreamSubscription? _announcementsSub;

  // A report the user just submitted, shown instantly at the top of the
  // list while the write is still in flight to Firestore. Cleared
  // automatically once the live snapshot listener confirms the matching
  // document has actually landed (see `_matchesOptimistic` below), so it
  // never lingers as a duplicate once the real data arrives.
  Incident? _optimisticIncident;

  List<Incident> get incidents {
    final pending = _optimisticIncident;
    if (pending == null) return List.unmodifiable(_incidents);
    return List.unmodifiable([pending, ..._incidents]);
  }

  List<Announcement> get announcements => List.unmodifiable(_announcements);

  /// Whether the reports list has ever been answered — by a snapshot, by an
  /// error, or by there being no signed-in resident to fetch for.
  ///
  /// This is what separates "you have no reports" from "we have not looked
  /// yet". An empty list means both until the first snapshot lands, and a feed
  /// that cannot tell them apart shows its empty state for the length of a cold
  /// start and then replaces it with content — which reads as the app having
  /// lost the resident's records and found them again.
  bool get hasLoadedIncidents => _incidentsAnswered;
  bool _incidentsAnswered = false;

  void _markIncidentsAnswered() {
    if (_incidentsAnswered) return;
    _incidentsAnswered = true;
  }

  /// The same distinction for the announcements feed. Without it the home
  /// sheet and the Announcements screen showed "No announcements" for the
  /// length of every cold start, then swapped in the feed.
  bool get hasLoadedAnnouncements => _announcementsAnswered;
  bool _announcementsAnswered = false;

  bool _matchesOptimistic(Incident synced, Incident pending) =>
      synced.reporterUid == pending.reporterUid &&
      synced.title == pending.title &&
      synced.reportedAt.millisecondsSinceEpoch ==
          pending.reportedAt.millisecondsSinceEpoch;

  /// Appends [incident] to the visible list immediately — before the
  /// Firestore write even starts — so the History list and dashboard reflect
  /// a new report with zero perceived latency. Call [addIncident] right
  /// after this to perform the real write; once its data round-trips
  /// through the live snapshot listener, this placeholder is dropped
  /// automatically. If the write ultimately fails, call
  /// [clearOptimisticIncident] to roll the placeholder back.
  void addIncidentOptimistic(Incident incident) {
    _optimisticIncident = incident;
    notifyListeners();
  }

  void clearOptimisticIncident() {
    if (_optimisticIncident == null) return;
    _optimisticIncident = null;
    notifyListeners();
  }

  int get activeIncidentsCount =>
      incidents.where((i) => i.status != IncidentStatus.resolved).length;

  void startListening() {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      // Nothing to wait for. Left unanswered, every feed would sit on its
      // skeleton indefinitely on the one path where no fetch is coming.
      _markIncidentsAnswered();
      _announcementsAnswered = true;
      return;
    }

    _incidentsSub?.cancel();
    _incidentsSub = _firestore
        .collection('incidents')
        .where('reporterUid', isEqualTo: user.uid)
        .orderBy('reportedAt', descending: true)
        .snapshots()
        .listen((snapshot) {
      _incidents = snapshot.docs.map((d) => Incident.fromFirestore(d)).toList();
      _markIncidentsAnswered();
      final pending = _optimisticIncident;
      if (pending != null &&
          _incidents.any((i) => _matchesOptimistic(i, pending))) {
        _optimisticIncident = null;
      }
      notifyListeners();
    }, onError: (_) {
      // An error is an answer. The feed shows its empty state, which at least
      // offers pull-to-refresh; a skeleton would offer nothing and never end.
      _markIncidentsAnswered();
      notifyListeners();
    });

    _announcementsSub?.cancel();
    _announcementsSub = _firestore
        .collection('announcements')
        .where('isArchived', isEqualTo: false)
        .orderBy('publishedAt', descending: true)
        .snapshots()
        .listen((snapshot) {
      _announcements =
          snapshot.docs.map((d) => Announcement.fromFirestore(d)).toList();
      _announcementsAnswered = true;
      notifyListeners();
    }, onError: (_) {
      // An error is an answer here too — see the incidents listener.
      _announcementsAnswered = true;
      notifyListeners();
    });
  }

  void stopListening() {
    _incidentsSub?.cancel();
    _announcementsSub?.cancel();
    _incidentsSub = null;
    _announcementsSub = null;
  }

  /// Called from pull-to-refresh. `incidents`/`announcements` are already
  /// kept live by the [startListening] snapshot subscriptions, so this
  /// doesn't need to "fetch" anything new — it re-arms the subscriptions
  /// (in case either silently died after a prior error) and awaits one real
  /// round-trip so the refresh gesture has a genuine completion signal to
  /// tie its loading indicator to, instead of an arbitrary fixed delay.
  /// Measured, like every other round trip this store makes: pull-to-refresh is
  /// the most frequent network call in the app, so it is what keeps
  /// [RequestPace] warm enough for the first delete of a session to be paced
  /// against this connection rather than against the seed.
  Future<void> refresh() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    startListening();
    await RequestPace.instance.measure(() => Future.wait([
          _firestore
              .collection('incidents')
              .where('reporterUid', isEqualTo: user.uid)
              .orderBy('reportedAt', descending: true)
              .get(),
          _firestore
              .collection('announcements')
              .where('isArchived', isEqualTo: false)
              .orderBy('publishedAt', descending: true)
              .get(),
        ]));
  }

  Future<DocumentReference> addIncident(Incident incident) async {
    final ref =
        await _firestore.collection('incidents').add(incident.toFirestore());
    return ref;
  }

  /// The resident's 1–5 star rating of a resolved report's response.
  ///
  /// One field, written once: firestore.rules accepts `residentRating` only
  /// from the reporter, only on a resolved report, only when it is not already
  /// there, and only as `{stars, comment, ratedAt}` with `ratedAt` the server
  /// time. The live listener then carries the rating back into [incidents],
  /// which is what stops the prompt from asking again.
  Future<void> rateIncident(String incidentId,
      {required int stars, String comment = ''}) {
    return _firestore.collection('incidents').doc(incidentId).update({
      'residentRating': {
        'stars': stars.clamp(1, 5),
        'comment': comment.trim().length > 500
            ? comment.trim().substring(0, 500)
            : comment.trim(),
        'ratedAt': FieldValue.serverTimestamp(),
      },
    });
  }

  /// Permanently deletes a report: its Storage evidence (best-effort) and then
  /// the Firestore document. The live listener removes it from the lists.
  ///
  /// Timed end to end through [RequestPace], and the WHOLE operation is what
  /// gets timed rather than the final document write — a report carrying four
  /// photos and a video takes as many round trips as it has attachments, and
  /// the progress bar a resident watches is over the delete they asked for, not
  /// over its last step.
  Future<void> deleteIncident(Incident incident) {
    return RequestPace.instance.measure(() async {
      final storage = FirebaseStorage.instance;
      for (final url in [...incident.photoUrls, ...incident.videoUrls]) {
        try {
          await storage.refFromURL(url).delete();
        } catch (_) {
          // Ignore — a missing/inaccessible file shouldn't block the delete.
        }
      }
      await _firestore.collection('incidents').doc(incident.id).delete();
    });
  }

  void clear() {
    stopListening();
    _incidents = [];
    _announcements = [];
    _optimisticIncident = null;
    // The next resident's feed has not been answered yet either.
    _incidentsAnswered = false;
    _announcementsAnswered = false;
    notifyListeners();
  }
}
