import 'package:flutter/foundation.dart';

import '../models/incident.dart';

/// Lightweight in-memory data store for incidents and announcements
/// surfaced on the home dashboard. Lists start empty so the UI shows
/// real-time, user-driven content rather than placeholder data.
///
/// Use `LocalDataStore.instance` and listen via `ListenableBuilder`.
class LocalDataStore extends ChangeNotifier {
  LocalDataStore._internal();
  static final LocalDataStore instance = LocalDataStore._internal();

  final List<Incident> _incidents = [];
  final List<Announcement> _announcements = [];

  List<Incident> get incidents => List.unmodifiable(_incidents);
  List<Announcement> get announcements => List.unmodifiable(_announcements);

  int get activeIncidentsCount =>
      _incidents.where((i) => i.status != IncidentStatus.resolved).length;

  void addIncident(Incident incident) {
    _incidents.insert(0, incident);
    notifyListeners();
  }

  void addAnnouncement(Announcement announcement) {
    _announcements.insert(0, announcement);
    notifyListeners();
  }

  void removeIncident(String id) {
    _incidents.removeWhere((i) => i.id == id);
    notifyListeners();
  }

  void clear() {
    _incidents.clear();
    _announcements.clear();
    notifyListeners();
  }
}
