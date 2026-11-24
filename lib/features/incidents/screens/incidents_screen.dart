import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/widgets/filter_pills.dart';
import 'package:monticello_villas_app/core/widgets/history_row.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_alert_record.dart';
import 'package:monticello_villas_app/features/panic_button/widgets/sos_history.dart';
import 'package:monticello_villas_app/core/network/request_pace.dart';
import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/incidents/models/report_deletion.dart';
import 'package:monticello_villas_app/features/incidents/widgets/history_skeleton.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/animated_list_entry.dart';
import 'package:monticello_villas_app/core/widgets/network_progress_bar.dart';
import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/core/widgets/shared_widgets.dart';

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
  double letterSpacing = 0,
  double height = 1.35,
}) {
  return sfPro(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}

class IncidentsScreen extends StatefulWidget {
  const IncidentsScreen({super.key, this.onBack});

  /// What the header's back arrow should do when this screen is a TAB in the
  /// home shell rather than a pushed route.
  ///
  /// Without it the arrow was dead: `Navigator.canPop()` is false for a tab, so
  /// the shared back button had nothing to pop and silently did nothing. Left
  /// null (the `/incidents` route case) the button pops as normal.
  final VoidCallback? onBack;

  @override
  State<IncidentsScreen> createState() => _IncidentsScreenState();
}

class _IncidentsScreenState extends State<IncidentsScreen> {
  static const _all = 0;
  static const _active = 1;
  static const _resolved = 2;

  static const _statuses = ['All', 'Active', 'Resolved'];
  static const _statusIcons = [
    PhosphorIconsFill.squaresFour,
    PhosphorIconsFill.clock,
    PhosphorIconsFill.checkCircle,
  ];

  /// ── THREE PAGES, NOT ONE FILTERED LIST ───────────────────────────────────
  /// The status filter narrowed a single list until now, and the comment that
  /// used to sit here argued against the alternative: a pager means three live
  /// [IncidentHistoryList]s where one would do.
  ///
  /// That trade is being made deliberately. A filter is something you set; a
  /// pager is something you move through, and moving through is what a swipe
  /// expresses — there is no way to swipe between views that do not exist as
  /// separate views. [PageView.builder] keeps the cost near where it was: only
  /// the current page and the one being dragged toward are alive, so a resting
  /// screen still holds exactly one list.
  ///
  /// What the pager does NOT change is that the tabs are still one closed
  /// choice over the same records. The control above is the shared green
  /// filter pills (FilterPillBar), the same as the Announcements feed.
  late final PageController _pages;

  int _index = _all;

  /// Reports the resident has confirmed away, from the moment the write starts
  /// until the row's progress bar has finished closing.
  ///
  /// Keyed by [_keyFor], and holding the [Incident] itself so the row survives
  /// Firestore dropping the document locally — see [_delete].
  final Map<String, ReportDeletion> _deleting = <String, ReportDeletion>{};

  /// The resident's SOS alerts, live, merged into every tab beside the
  /// reports: open ones under Active, closed ones under Resolved.
  final SosHistoryController _sos = SosHistoryController();

  @override
  void initState() {
    super.initState();
    _pages = PageController(initialPage: _index);
    _sos.start();
  }

  @override
  void dispose() {
    _sos.dispose();
    _pages.dispose();
    super.dispose();
  }

  /// Tapping a segment travels the same path a swipe does, so the pages and
  /// the indicator can never disagree about where they are.
  void _goToTab(int index) {
    _pages.animateToPage(
      index,
      duration: SegmentedControl.slide,
      curve: Curves.easeOutCubic,
    );
  }

  /// The feed's own key function, so a deletion this screen is tracking and the
  /// row drawing its progress bar can never key themselves differently.
  static String _keyFor(Incident i) => IncidentHistoryList.keyFor(i);

  bool _matches(Incident i, int tab) {
    switch (tab) {
      case _active:
        return !i.status.isTerminal;
      case _resolved:
        return i.status.isTerminal;
      default:
        return true;
    }
  }

  /// Distinguishes "you have filed nothing" from "nothing is in this tab" —
  /// the same words for both is how a filter convinces someone their records
  /// were deleted.
  bool _matchesSos(SosAlertRecord r, int tab) => switch (tab) {
        _active => r.stage.isOpen,
        _resolved => !r.stage.isOpen,
        _ => true,
      };

  String? _emptyMessage(int tab, {required bool nothingFiled}) {
    if (nothingFiled || tab == _all) return null;
    return tab == _active
        ? 'Nothing is open right now. Resolved reports are under the '
            'Resolved tab.'
        : 'No report has been resolved yet. Open ones are under the '
            'Active tab.';
  }

  /// Runs AFTER the resident has confirmed — the prompt belongs to the row that
  /// raised it, so the screen's job here is only the write.
  ///
  /// ── THE CARD STAYS PUT UNTIL THE WRITE LANDS ─────────────────────────────
  /// The optimistic removal this used to do has been inverted. It took the card
  /// away the instant the resident confirmed and put it back if the write
  /// failed, which is the right trade when there is nothing to show in the
  /// meantime — but it means a delete over a slow connection is indisting-
  /// uishable from a delete over a fast one, and a failure is a card that
  /// reappears seconds later with no account of why.
  ///
  /// The row now HOLDS, showing a progress bar paced by [RequestPace] against
  /// this connection's recent round trips, and leaves only when the server has
  /// actually answered. Firestore drops the document from its local cache the
  /// moment `delete()` is called, so keeping the row on screen is what
  /// [ReportDeletion] carries the incident for — see [build].
  Future<void> _delete(Incident incident) async {
    final key = _keyFor(incident);
    setState(() {
      _deleting[key] = ReportDeletion(
        incident: incident,
        expected: RequestPace.instance.estimate,
      );
    });

    final deleted = await deleteReport(context, incident);
    if (!mounted) return;
    final job = _deleting[key];
    if (job == null) return;
    // The bar runs to full, or stops red. Either way the row is taken away by
    // `_finishDeletion`, once the resident has seen which of the two happened.
    setState(() {
      _deleting[key] = job.settled(
        deleted ? NetworkTaskState.succeeded : NetworkTaskState.failed,
      );
    });
  }

  /// The bar has finished. Drop the row — on success it is already gone from
  /// the store, and on failure Firestore has rolled its local delete back, so
  /// in both cases the plain list is now correct.
  void _finishDeletion(String key) {
    if (!mounted || !_deleting.containsKey(key)) return;
    setState(() => _deleting.remove(key));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Read-only header. The "+ Report" pill that used to sit on the
            // right is gone: History is a record, and an action that creates
            // new records does not belong on the screen for reading old ones —
            // filing is reachable from the nav bar on every screen anyway.
            //
            // Centred via a Stack against the FULL header width, not an
            // Expanded between the two ends. An Expanded centres the title in
            // the space left over after the back button, which pushes it right
            // by half the button's width — visibly off-centre on a phone, and
            // the reason the title only *looked* centred on screens with no
            // leading widget. See the identical header on Announcements.
            // As a pushed route the back button pops; as a tab in the home
            // shell it falls back to whatever the host says "back" means.
            PageTitleBar(title: 'History', onNothingToPop: widget.onBack),
            // OUTSIDE the ListenableBuilder. The tab state is this screen's,
            // not the store's — nesting it under the listener rebuilt the
            // control on every Firestore snapshot, which is a rebuild of a
            // widget whose appearance cannot have changed.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              // The same green pills as the Announcements feed.
              child: FilterPillBar(
                padding: EdgeInsets.zero,
                selectedIndex: _index,
                onChanged: _goToTab,
                options: [
                  for (var i = 0; i < _statuses.length; i++)
                    FilterPillOption(_statuses[i], icon: _statusIcons[i]),
                ],
              ),
            ),
            Expanded(
              child: ListenableBuilder(
                listenable: Listenable.merge([LocalDataStore.instance, _sos]),
                builder: (context, _) {
                  // Nothing has been fetched yet — not "you have no reports".
                  // See LocalDataStore.hasLoadedIncidents.
                  final loaded = LocalDataStore.instance.hasLoadedIncidents;

                  // Reports being deleted are merged back in: Firestore has
                  // already dropped them locally, and their rows have to stay
                  // on screen for as long as their progress bars are running.
                  // Re-sorted rather than appended, so a held row sits where it
                  // has always sat instead of jumping to the end of the feed.
                  final deleting = _deleting.keys.toSet();
                  final source = [
                    ...LocalDataStore.instance.incidents
                        .where((i) => !deleting.contains(_keyFor(i))),
                    ..._deleting.values.map((d) => d.incident),
                  ]..sort((a, b) => b.reportedAt.compareTo(a.reportedAt));

                  return PageView.builder(
                    controller: _pages,
                    itemCount: _statuses.length,
                    // Fires on settle, not during the drag, so this never
                    // rebuilds a page mid-swipe; the pill follows then.
                    onPageChanged: (i) => setState(() => _index = i),
                    itemBuilder: (context, tab) => !loaded
                        ? const HistoryFeedSkeleton()
                        : IncidentHistoryList(
                      incidents:
                          source.where((i) => _matches(i, tab)).toList(),
                      sosAlerts: _sos.records
                          .where((r) => _matchesSos(r, tab))
                          .toList(),
                      onRefresh: () async {
                        await Future.wait([
                          LocalDataStore.instance.refresh(),
                          _sos.refresh(),
                        ]);
                      },
                      emptyMessage: _emptyMessage(
                        tab,
                        nothingFiled: source.isEmpty && _sos.records.isEmpty,
                      ),
                      // Deletion lives on ONE tab. See IncidentHistoryList.canDelete.
                      canDelete: tab == _resolved,
                      onDelete: _delete,
                      deletions: _deleting,
                      onDeletionSettled: _finishDeletion,
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── NO TAB CARRIES A NOTICE ANY MORE ──────────────────────────────────────
  //
  // `_hintFor` used to sit here and hand each tab a standing line above its
  // feed: the All tab's retention policy first, then — after that one went —
  // "Press and hold a report to delete it" on Resolved and "Open reports can't
  // be deleted" on Active. All three are gone, and the reasoning that kept the
  // last two is worth writing down because it was not wrong, it was outweighed.
  //
  // A press-and-hold has no visual affordance, so a line teaching it is the
  // only way a resident learns the gesture exists. What that line costs is a
  // permanent band of instructions on a screen opened to read two records and
  // leave — paid on every visit, by everyone, forever, to teach a one-time
  // fact. The screen is a record; the records are what belong at the top of it.
  //
  // The gesture itself is unchanged and still explains itself the moment it is
  // found: holding a resolved card opens a named confirmation, and holding
  // anything else does nothing at all. If discoverability turns out to matter
  // more than the clear top, the honest fix is an affordance ON the card — not
  // a paragraph above the list.
}

/// The History feed for one tab.
///
/// Public, and takes [onRefresh] rather than reaching for
/// `LocalDataStore.instance` itself, so the whole subtree can be built without
/// Firebase behind it. That is what makes the tab-scoped delete rule — the one
/// thing on this screen where being wrong loses a resident's record —
/// assertable in a widget test instead of only by reading.
class IncidentHistoryList extends StatelessWidget {
  final List<Incident> incidents;

  /// SOS alerts shown in the same feed, interleaved with the reports by date.
  final List<SosAlertRecord> sosAlerts;

  /// Shown instead of the stock "no reports yet" copy when the list is empty
  /// only because a filter is narrowing it.
  final String? emptyMessage;

  /// Whether THIS tab offers deletion at all.
  ///
  /// ── A SECOND GATE, ON TOP OF THE PER-REPORT ONE ──────────────────────────
  /// [IncidentLifecycle.isDeletable] answers "may this report ever be
  /// removed"; this answers "is removing things something this view does". Both
  /// have to be true, and they are genuinely different questions: a resolved
  /// report is deletable wherever it appears, but the All feed is where a
  /// resident goes to READ their history, mixing open and closed records in one
  /// scroll. A destructive action living in that view is one stray hold away
  /// from a prompt over a record the resident was only browsing past.
  ///
  /// Confining deletion to the Resolved tab makes the destructive gesture live
  /// in exactly one place, where every card in view is a finished record and
  /// the resident arrived by choosing that view.
  final bool canDelete;

  final Future<void> Function(Incident) onDelete;

  final Future<void> Function() onRefresh;

  /// Deletes currently in flight, keyed by [keyFor]. A row whose key is in here
  /// renders held and dimmed under a [NetworkProgressBar] instead of as a
  /// tappable card.
  final Map<String, ReportDeletion> deletions;

  /// Fires when a row's progress bar has finished — success or failure — with
  /// the key of the delete it was drawing.
  final ValueChanged<String>? onDeletionSettled;

  const IncidentHistoryList({
    super.key,
    required this.incidents,
    this.sosAlerts = const [],
    required this.canDelete,
    required this.onDelete,
    required this.onRefresh,
    this.emptyMessage,
    this.deletions = const {},
    this.onDeletionSettled,
  });

  /// Stable identity for a report, including one filed seconds ago that has no
  /// server id yet.
  ///
  /// Public and static because the screen keys its in-flight deletions by it:
  /// the two were computing the same string in two places, and a row and its
  /// progress bar disagreeing about which report they are would be silent.
  static String keyFor(Incident incident) => incident.id.isEmpty
      ? '${incident.title}_${incident.reportedAt.millisecondsSinceEpoch}'
      : incident.id;

  /// Asks, then writes. Split that way round because the prompt belongs to the
  /// row the resident held down, while the write belongs to the screen that
  /// owns the list — see [_IncidentsScreenState._delete].
  Future<void> _confirmThenDelete(
      BuildContext context, Incident incident) async {
    if (!await confirmReportDeletion(context, incident)) return;
    await onDelete(incident);
  }

  /// One row: a card that answers a press-and-hold where deletion is on offer
  /// AND the report itself may go.
  ///
  /// ── ONE GESTURE, NOT TWO ─────────────────────────────────────────────────
  /// Resolved cards used to carry BOTH a swipe-to-delete and a long press, and
  /// the swipe is the half that has been withdrawn. Two gestures for one
  /// destructive action is one more than the action deserves, and the swipe was
  /// the worse of the pair here: this list lives inside a [PageView], so every
  /// horizontal drag on a Resolved card was a drag the pager could not have.
  /// Sliding between History's three tabs — an ordinary, non-destructive
  /// motion — stopped working on the cards themselves, and only on the one tab
  /// where the alternative meaning was "delete this".
  ///
  /// With the [Dismissible] gone, no card anywhere in this feed claims a
  /// horizontal drag: the pager swipes freely from anywhere on any tab, and the
  /// destructive path is a deliberate hold that cannot be started by a scroll
  /// that drifted sideways.
  ///
  /// Null on every other tab, which leaves those cards with no delete path at
  /// all rather than a hold that silently refuses.
  Widget _row(BuildContext context, Incident incident) {
    final key = keyFor(incident);
    final deletion = deletions[key];

    return AnimatedListEntry(
      key: ValueKey('entry-$key'),
      child: deletion == null
          ? _IncidentCard(
              incident: incident,
              onLongPressDelete: canDelete && incident.status.isDeletable
                  ? () => _confirmThenDelete(context, incident)
                  : null,
            )
          : _DeletingCard(
              incident: incident,
              deletion: deletion,
              onSettled: () => onDeletionSettled?.call(key),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Reports and SOS alerts, newest first. Each keeps its own card: a report
    // opens its report timeline, an SOS opens its dispatch timeline.
    final entries = <({DateTime at, Incident? incident, SosAlertRecord? sos})>[
      for (final i in incidents) (at: i.reportedAt, incident: i, sos: null),
      for (final r in sosAlerts) (at: r.raisedAt, incident: null, sos: r),
    ]..sort((a, b) => b.at.compareTo(a.at));

    return RefreshShell(
      onRefresh: onRefresh,
      child: entries.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(height: MediaQuery.of(context).size.height * 0.12),
                _EmptyState(message: emptyMessage),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              // Edge to edge, split by hairlines, as the notification feed is.
              padding: const EdgeInsets.fromLTRB(0, 4, 0, 100),
              itemCount: entries.length,
              separatorBuilder: (_, __) => const Divider(
                height: 1,
                thickness: 1,
                indent: 68,
                color: AppColors.borderNeutralSoft,
              ),
              itemBuilder: (context, i) {
                final entry = entries[i];
                return entry.incident != null
                    ? _row(context, entry.incident!)
                    : AnimatedListEntry(
                        key: ValueKey('sos-${entry.sos!.id}'),
                        child: SosHistoryCard(record: entry.sos!),
                      );
              },
            ),
    );
  }
}

/// A card whose report is being deleted right now.
///
/// ── THE ROW IS THE PROGRESS INDICATOR ─────────────────────────────────────
/// Not a modal, not a spinner in the corner, not a snackbar: the card that is
/// going stays exactly where it was, dimmed, with the bar drawn across its
/// foot. A resident who has just confirmed a destructive action is looking at
/// the thing they confirmed, and that is where the answer to "is it working?"
/// belongs. It also means a second report can be deleted while the first is
/// still in flight — each row carries its own bar — which a blocking overlay
/// would have to forbid.
///
/// The card underneath keeps its full layout rather than collapsing to a strip,
/// so the feed does not reflow twice (once to start the delete, once to finish
/// it) around a row that may yet come back.
class _DeletingCard extends StatelessWidget {
  const _DeletingCard({
    required this.incident,
    required this.deletion,
    required this.onSettled,
  });

  final Incident incident;
  final ReportDeletion deletion;
  final VoidCallback onSettled;

  @override
  Widget build(BuildContext context) {
    final failed = deletion.state == NetworkTaskState.failed;

    return Stack(
      children: [
        // Inert AND unreadable to a screen reader as a control: this row is
        // mid-write, and a tap that opened its timeline would be opening a
        // record that is being destroyed.
        IgnorePointer(
          child: Opacity(
            opacity: 0.45,
            child: ExcludeSemantics(child: _IncidentCard(incident: incident)),
          ),
        ),
        Positioned.fill(
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        failed
                            ? PhosphorIconsFill.warningCircle
                            : PhosphorIconsFill.trash,
                        size: 13,
                        color:
                            failed ? AppColors.danger : AppColors.textSecondary,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          failed
                              ? 'Couldn\'t delete — the report is still here.'
                              : 'Deleting report…',
                          style: _t(
                            size: 11.5,
                            weight: FontWeight.w600,
                            color: failed
                                ? AppColors.danger
                                : AppColors.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 7),
                  // Paced against this connection, snapped to full by the
                  // server's answer. See NetworkProgressBar.
                  NetworkProgressBar(
                    expected: deletion.expected,
                    state: deletion.state,
                    onSettled: onSettled,
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _IncidentCard extends StatelessWidget {
  final Incident incident;

  /// Null on every tab but Resolved, which leaves the card with no delete
  /// affordance at all rather than a long press that silently refuses.
  final VoidCallback? onLongPressDelete;

  const _IncidentCard({required this.incident, this.onLongPressDelete});

  @override
  Widget build(BuildContext context) {
    // Notification-style row (core/widgets/history_row.dart), shared with
    // the SOS entries in the same feed. Tap opens the report's timeline;
    // long-press deletes where the tab allows it.
    return HistoryRow(
      icon: IncidentCategoryInfo.icon(incident.category),
      tint: IncidentPriorityInfo.color(incident.priority),
      title: incident.title,
      detail: [incident.category, incident.location]
          .where((part) => part.trim().isNotEmpty)
          .join(' · '),
      at: incident.reportedAt,
      statusLabel: IncidentStatusInfo.label(incident.status),
      statusColor: IncidentStatusInfo.color(incident.status),
      onTap: () => showIncidentTimeline(context, incident),
      onLongPress: onLongPressDelete,
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({this.message});

  /// Set when the list is empty because a status tab is narrowing it, rather
  /// than because nothing has been filed.
  final String? message;

  @override
  Widget build(BuildContext context) {
    final filtering = message != null;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha: 0.08),
              ),
              child: Icon(
                  filtering
                      ? PhosphorIconsFill.funnel
                      : PhosphorIconsFill.shield,
                  color: AppColors.primary,
                  size: 32),
            ),
            const SizedBox(height: 16),
            Text(
              filtering ? 'Nothing In This Tab' : 'No Reports Found',
              style: _t(size: 16, weight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              message ??
                  'Reports you file will appear here with live status tracking.',
              textAlign: TextAlign.center,
              style: _t(
                  size: 13.5, color: AppColors.textSecondary, height: 1.5),
            ),
            // The "File a Report" call to action that used to close this empty
            // state has been removed for the same reason as the header pill —
            // History reads, it does not create. The copy above already tells
            // the resident where filed reports show up.
          ],
        ),
      ),
    );
  }
}
