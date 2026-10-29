import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/history_row.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_alert_record.dart';
import 'package:monticello_villas_app/features/panic_button/services/panic_alert_service.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_queue.dart';

Color _stageColor(SosStage stage) => switch (stage) {
      SosStage.waiting => AppColors.warningInk,
      SosStage.dispatched => AppColors.panicOxblood,
      SosStage.inProgress => AppColors.primaryDark,
      SosStage.resolved => AppColors.success,
    };

/// The resident's SOS alerts, live, for the History feed (2026-10-29: merged
/// into All / Active / Resolved beside the reports, by request, rather than a
/// tab of their own).
///
/// One `panic_alerts` listener (residentUid == the signed-in resident) plus
/// whatever is still queued on this phone, merged newest first. Every status
/// a guard writes — acknowledged, resolved — arrives through the listener and
/// [records] changes at once.
///
/// The listen re-subscribes after an error (a signed-out moment, a dropped
/// channel) instead of leaving the feed frozen on its last answer — the same
/// rule the rest of the app's listeners follow.
class SosHistoryController extends ChangeNotifier {
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _sub;
  Timer? _relisten;
  Timer? _queuePoll;
  List<SosAlertRecord> _server = const [];
  List<SosAlertRecord> _queued = const [];
  bool _disposed = false;

  /// True once the first answer (or the first failure) is in.
  bool loaded = false;

  List<SosAlertRecord> get records => mergeSosHistory(_server, _queued);

  void start() {
    _listen();
    readQueue();
    // The queue drains in the background when signal returns; look again
    // now and then so a "Waiting for signal" row does not outlive its alert.
    _queuePoll ??= Timer.periodic(const Duration(seconds: 15), (_) => readQueue());
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _listen() {
    _sub?.cancel();
    _relisten?.cancel();
    String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      uid = null; // No Firebase app (tests, a failed boot): nothing to read.
    }
    if (uid == null) {
      loaded = true;
      _notify();
      return;
    }
    // Equality only, sorted here: an orderBy beside the residentUid filter
    // would need a composite index, for a list that is a handful of rows.
    _sub = FirebaseFirestore.instance
        .collection(PanicAlertService.collection)
        .where('residentUid', isEqualTo: uid)
        .snapshots()
        .listen(
      (snap) {
        _server = snap.docs.map(SosAlertRecord.fromFirestore).toList();
        loaded = true;
        _notify();
        readQueue();
      },
      onError: (Object err) {
        debugPrint('SOS history listener failed: $err');
        loaded = true;
        _notify();
        _relisten = Timer(const Duration(seconds: 5), () {
          if (!_disposed) _listen();
        });
      },
    );
  }

  /// Pull-to-refresh: listen again and re-read the queue.
  Future<void> refresh() async {
    _listen();
    await readQueue();
  }

  Future<void> readQueue() async {
    try {
      final items = await SosQueue.pending();
      if (_disposed) return;
      _queued = items.map(SosAlertRecord.queued).toList();
      _notify();
    } catch (_) {
      // An unreadable queue is the sync service's problem to report; the
      // server history still shows.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _sub?.cancel();
    _relisten?.cancel();
    _queuePoll?.cancel();
    super.dispose();
  }
}

/// One SOS alert as a History row — the same [HistoryRow] a report uses,
/// so the two read as one feed. Tapping it opens the live status timeline.
class SosHistoryCard extends StatelessWidget {
  const SosHistoryCard({super.key, required this.record});

  final SosAlertRecord record;

  @override
  Widget build(BuildContext context) {
    return HistoryRow(
      icon: PhosphorIconsFill.siren,
      tint: AppColors.panicOxblood,
      title: 'SOS alert',
      detail: record.place ?? 'Location from your phone',
      at: record.raisedAt,
      statusLabel: record.stage.label,
      statusColor: _stageColor(record.stage),
      onTap: () => showSosTimeline(context, record),
    );
  }
}

class _StagePill extends StatelessWidget {
  const _StagePill({required this.stage, required this.color});

  final SosStage stage;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Text(stage.label,
          style: sfPro(fontSize: 11, fontWeight: FontWeight.w700, color: color, letterSpacing: 0.2)),
    );
  }
}

/// The status timeline for one alert, live while it is open.
void showSosTimeline(BuildContext context, SosAlertRecord record) {
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (_) => _SosTimelineSheet(initial: record),
  );
}

class _SosTimelineSheet extends StatefulWidget {
  const _SosTimelineSheet({required this.initial});

  final SosAlertRecord initial;

  @override
  State<_SosTimelineSheet> createState() => _SosTimelineSheetState();
}

class _SosTimelineSheetState extends State<_SosTimelineSheet> {
  late SosAlertRecord _record = widget.initial;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _sub;

  @override
  void initState() {
    super.initState();
    // A queued alert has no document yet (and a listen on a missing one is
    // refused by the rules), so only an alert the server has is followed.
    if (_record.stage != SosStage.waiting) {
      _sub = FirebaseFirestore.instance
          .collection(PanicAlertService.collection)
          .doc(_record.id)
          .snapshots()
          .listen((snap) {
        if (!mounted || !snap.exists) return;
        setState(() => _record = SosAlertRecord.fromFirestore(snap));
      }, onError: (Object err) => debugPrint('SOS timeline listener failed: $err'));
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final r = _record;
    const radius = BorderRadius.vertical(top: Radius.circular(AppRadius.xl));
    return DraggableScrollableSheet(
      initialChildSize: 0.66,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      builder: (_, controller) => ClipRRect(
        borderRadius: radius,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: radius,
            border: Border.all(color: AppColors.borderNeutralSoft),
          ),
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(24, 12, 24, 40),
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.borderNeutralStrong,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Align(alignment: Alignment.centerLeft, child: _StagePill(stage: r.stage, color: _stageColor(r.stage))),
              const SizedBox(height: 10),
              Text('SOS alert',
                  style: sfPro(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.textPrimary, letterSpacing: -0.3)),
              const SizedBox(height: 4),
              Text(
                'Sent ${DateFormat('EEEE, MMM d, yyyy • h:mm a').format(r.raisedAt)}',
                style: sfPro(fontSize: 13, color: AppColors.textSecondary),
              ),
              if (r.place != null) ...[
                const SizedBox(height: 2),
                Text(r.place!, style: sfPro(fontSize: 13, color: AppColors.textSecondary)),
              ],
              const SizedBox(height: 20),
              const Divider(height: 1, color: AppColors.borderNeutralSoft),
              const SizedBox(height: 20),
              Text('Status Timeline',
                  style: sfPro(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.onGlassMuted, letterSpacing: 0.7)),
              const SizedBox(height: 18),
              if (r.stage == SosStage.waiting)
                Container(
                  margin: const EdgeInsets.only(bottom: 18),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(AppRadius.lg),
                  ),
                  child: Text(
                    'Saved on this phone without signal. It sends itself when you are back online; '
                    'the guardhouse has not received it yet.',
                    style: sfPro(fontSize: 12.5, color: AppColors.warningInk, height: 1.45),
                  ),
                ),
              SosStatusTimeline(record: r),
              const SizedBox(height: 8),
              Text('Reference ${r.id}', style: sfPro(fontSize: 11, color: AppColors.textMuted)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Dispatched → Dispatch in progress → Resolved, each ticked only by what the
/// guardhouse actually wrote to the alert, with the time it happened.
class SosStatusTimeline extends StatelessWidget {
  const SosStatusTimeline({super.key, required this.record});

  final SosAlertRecord record;

  static const _steps = [
    (SosStage.dispatched, 'Dispatched', 'The guardhouse received your alert', PhosphorIconsFill.siren),
    (SosStage.inProgress, 'Dispatch in progress', 'A guard is responding', PhosphorIconsFill.personSimpleRun),
    (SosStage.resolved, 'Resolved', 'The guardhouse closed the alert', PhosphorIconsFill.checkCircle),
  ];

  @override
  Widget build(BuildContext context) {
    final reached = record.stage.step;
    return Column(
      children: [
        for (final (i, (stage, title, detail, icon)) in _steps.indexed)
          _row(
            title: title,
            detail: switch (stage) {
              SosStage.inProgress when record.respondedBy != null && i <= reached =>
                '${i == reached && record.stage.isOpen ? 'Responding' : 'Responded'}: ${record.respondedBy}',
              _ => i <= reached ? detail : 'Pending',
            },
            icon: icon,
            done: i < reached || (i == reached && !record.stage.isOpen),
            active: i == reached && record.stage.isOpen,
            time: i <= reached ? record.timeOf(stage) : null,
            last: i == _steps.length - 1,
            notes: stage == SosStage.resolved && i <= reached ? record.resolutionNotes : null,
          ),
      ],
    );
  }

  Widget _row({
    required String title,
    required String detail,
    required IconData icon,
    required bool done,
    required bool active,
    required DateTime? time,
    required bool last,
    String? notes,
  }) {
    final on = done || active;
    final color = on ? AppColors.success : AppColors.borderNeutralStrong;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: color,
                    boxShadow: active
                        ? [BoxShadow(color: AppColors.success.withValues(alpha: 0.35), blurRadius: 8, spreadRadius: 2)]
                        : null,
                  ),
                  child: Icon(on ? icon : PhosphorIconsFill.circle, size: 11, color: on ? Colors.white : AppColors.onGlassMuted),
                ),
                if (!last)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 6),
                      color: done ? AppColors.success.withValues(alpha: 0.6) : AppColors.borderNeutral,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? 0 : 22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    height: 22,
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(title,
                          style: sfPro(
                            fontSize: 14,
                            fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                            color: on ? AppColors.onGlassPrimary : AppColors.onGlassSecondary,
                          )),
                    ),
                  ),
                  Text(detail,
                      style: sfPro(
                        fontSize: 12,
                        height: 1.35,
                        color: active ? AppColors.success : (on ? AppColors.onGlassSecondary : AppColors.onGlassMuted),
                        fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                      )),
                  if (time != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.success.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(DateFormat('MMM d • h:mm a').format(time),
                          style: sfPro(fontSize: 10.5, fontWeight: FontWeight.w600, color: AppColors.success)),
                    ),
                  ],
                  if (notes != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.success.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                      ),
                      child: Text('Guard notes: $notes',
                          style: sfPro(fontSize: 12, color: AppColors.onGlassSecondary, height: 1.4)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
