import 'package:monticello_villas_app/core/widgets/network_progress_bar.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

/// One delete a resident has confirmed, from the prompt until its progress bar
/// has finished closing.
///
/// ── WHY THE INCIDENT IS HELD HERE ─────────────────────────────────────────
/// Firestore applies a delete to its local cache the instant it is called, so
/// the snapshot listener drops the document — and the History feed drops the
/// card — long before the server has acknowledged anything. A progress bar
/// drawn on that card would vanish a frame after it appeared, and would be
/// showing the resident the finish of a write that had not finished.
///
/// Keeping the [Incident] itself means the screen can hold the row in place for
/// exactly as long as the request is actually running, then take it away when
/// the bar says so. See `_IncidentsScreenState.build`, which merges these back
/// into the store's list.
class ReportDeletion {
  ReportDeletion({
    required this.incident,
    required this.expected,
    this.state = NetworkTaskState.running,
  });

  final Incident incident;

  /// The round trip this delete is paced against, captured when it started —
  /// see [RequestPace]. Held rather than read live so a bar already running
  /// does not re-pace under a resident who is watching it.
  final Duration expected;

  final NetworkTaskState state;

  ReportDeletion settled(NetworkTaskState state) => ReportDeletion(
        incident: incident,
        expected: expected,
        state: state,
      );
}
