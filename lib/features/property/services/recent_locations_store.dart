import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';

/// Locally remembered address selections, newest first.
///
/// Backs the "Recent locations" section of the location search — the Grab
/// behaviour where the second report you file is mostly already typed.
///
/// DEVICE-LOCAL ON PURPOSE. This is a typing shortcut, not resident data. It is
/// not written to Firestore, so it never becomes a record of which lots a
/// person has been looking up, and a shared handset does not carry one
/// household's addresses into another's report.
class RecentLocationsStore {
  RecentLocationsStore._();

  /// Versioned so the format can change without having to read old entries.
  static const String _key = 'recent_incident_locations_v1';

  /// Six rows. Enough that the common case is one tap, few enough that the list
  /// still fits above the keyboard without becoming its own scroll problem.
  static const int maxEntries = 6;

  /// Never throws. A failure here costs a convenience list, and losing it must
  /// not stop someone reporting an incident.
  static Future<List<SubdivisionAddress>> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getStringList(_key) ?? const [];
      return raw
          .map(SubdivisionAddress.parse)
          .whereType<SubdivisionAddress>()
          // An address that was valid when saved can stop existing when the
          // directory is corrected. Dropping it here is what stops a stale
          // shortcut re-entering a lot the estate no longer has.
          .where((a) => SubdivisionDirectory.exists(a.phase, a.block, a.lot))
          .take(maxEntries)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Promotes [address] to the head of the list and returns the new list.
  ///
  /// Returns the updated list rather than requiring the caller to re-read,
  /// so the dropdown can repaint from the same value it just persisted instead
  /// of racing its own write.
  static Future<List<SubdivisionAddress>> remember(
    SubdivisionAddress address,
  ) async {
    List<SubdivisionAddress> next;
    try {
      final current = await load();
      next = [
        address,
        // Re-selecting an address MOVES it to the top rather than adding a
        // duplicate — otherwise the list fills with one lot and evicts the
        // others it exists to remember.
        ...current.where((a) => a != address),
      ].take(maxEntries).toList();

      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(
        _key,
        next.map((a) => a.storageKey).toList(),
      );
    } catch (_) {
      // Persisting failed; still hand back the optimistic list so the UI this
      // session behaves correctly.
      next = [address];
    }
    return next;
  }

  static Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_key);
    } catch (_) {
      // Nothing to recover — the list is a cache.
    }
  }
}
