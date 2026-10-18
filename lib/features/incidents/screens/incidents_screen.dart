import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/network/request_pace.dart';
import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/incidents/models/report_deletion.dart';
import 'package:monticello_villas_app/features/incidents/widgets/history_skeleton.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/animated_list_entry.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
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
  /// choice over the same records — which is why the control above stays a
  /// segmented control and does not become a [TabBar].
  late final PageController _pages;

  /// Continuous page position, driving the indicator frame by frame.
  ///
  /// A [ValueNotifier] rather than screen state on purpose: this changes on
  /// every frame of a drag, and calling `setState` at that rate would rebuild
  /// the whole feed to move one pill. See [SegmentedControl.position].
  final ValueNotifier<double> _tabPosition = ValueNotifier<double>(0);

  int _index = _all;

  /// Reports the resident has confirmed away, from the moment the write starts
  /// until the row's progress bar has finished closing.
  ///
  /// Keyed by [_keyFor], and holding the [Incident] itself so the row survives
  /// Firestore dropping the document locally — see [_delete].
  final Map<String, ReportDeletion> _deleting = <String, ReportDeletion>{};

  @override
  void initState() {
    super.initState();
    _pages = PageController(initialPage: _index)..addListener(_trackPage);
  }

  @override
  void dispose() {
    _pages.removeListener(_trackPage);
    _pages.dispose();
    _tabPosition.dispose();
    super.dispose();
  }

  void _trackPage() {
    // `page` throws if the controller has no viewport attached yet, and is
    // null for the frame between attaching and the first layout.
    if (!_pages.hasClients) return;
    final page = _pages.page;
    if (page != null) _tabPosition.value = page;
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
              child: SegmentedControl(
                segments: _statuses,
                selectedIndex: _index,
                position: _tabPosition,
                onChanged: _goToTab,
              ),
            ),
            Expanded(
              child: ListenableBuilder(
                listenable: LocalDataStore.instance,
                builder: (context, _) {
                  // Nothing has been fetched yet — not "you have no reports".
                  // See LocalDataStore.hasLoadedIncidents.
                  if (!LocalDataStore.instance.hasLoadedIncidents) {
                    return const HistoryFeedSkeleton();
                  }

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
                    // rebuilds a page mid-swipe. The INDICATOR does not wait
                    // for it — that follows `_tabPosition` continuously.
                    onPageChanged: (i) => setState(() => _index = i),
                    itemBuilder: (context, tab) => IncidentHistoryList(
                      incidents:
                          source.where((i) => _matches(i, tab)).toList(),
                      onRefresh: LocalDataStore.instance.refresh,
                      emptyMessage: _emptyMessage(
                        tab,
                        nothingFiled: source.isEmpty,
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
    return RefreshShell(
      onRefresh: onRefresh,
      child: incidents.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(height: MediaQuery.of(context).size.height * 0.12),
                _EmptyState(message: emptyMessage),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              // Item 0 is a REPORT. Nothing is prepended to this feed any
              // more — no hint, no notice — and the top inset is 8 rather than
              // 16 because the segmented control above already contributes 12
              // of its own: the first card now sits directly under the filter
              // rather than under a band of instructions.
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
              itemCount: incidents.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, i) => _row(context, incidents[i]),
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

  String _relative(DateTime t) {
    final diff = DateTime.now().difference(t);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final pColor = IncidentPriorityInfo.color(incident.priority);
    final sColor = IncidentStatusInfo.color(incident.status);

    // ── AppCard, NOT A HAND-ROLLED InkWell ──────────────────────────────────
    //
    // This was a Material/InkWell over a borderless Container with its own
    // 16px shadow — the one card in the app that painted its own container,
    // with a RIPPLE where every other card scales.
    //
    // The ripple is the part that mattered. On a surface this size a splash
    // reads as a wash crawling across the content rather than as the card
    // responding to a finger; scaling moves the whole object, which is what
    // "tactile" means at card scale. AppCard already does exactly that at 0.98
    // with a selection haptic and a Semantics button role, so this row gets the
    // same press behaviour as every other container in the app instead of a
    // private imitation of it.
    //
    // ── WHITE PANEL, SOFT SHADOW, SLATE-100 HAIRLINE ────────────────────────
    // This card has now been all three points of the same triangle. It began
    // outlined in slate-200 at 1.5px with `shadow-sm`; that stroke boxed it in
    // a feed of peers, so it went fully borderless on `shadow-md`; a shadow
    // that heavy on pure white is the other failure — the cards start to hover
    // rather than sit, and a column of them reads as a stack of floating
    // panels.
    //
    // This is the settled middle, and the two numbers are what make it work
    // rather than a compromise between two wrongs: the stroke is slate-100
    // (the palette's faintest structural rule) at 1px, not slate-200 at 1.5px.
    // At that weight the line does not draw a box — it just stops two whites
    // from bleeding into each other where the shadow alone is too soft to
    // separate them, which is exactly the job [AppColors.borderNeutralSoft]
    // exists for. The press scale, haptic and semantics are unchanged.
    return AppCard(
      onTap: () => showIncidentTimeline(context, incident),
      // Only on the Resolved tab — see [IncidentHistoryList.canDelete].
      onLongPress: onLongPressDelete,
      borderColor: AppColors.borderNeutralSoft,
      borderWidth: AppStroke.hairline,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: pColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child:
                        Icon(IncidentCategoryInfo.icon(incident.category),
                            color: pColor, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          incident.title,
                          style: _t(
                              size: 14,
                              weight: FontWeight.w600,
                              color: AppColors.textPrimary),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${incident.id} · ${incident.category}',
                          style: _t(size: 11.5, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Fill only. The 25%-alpha ring this used to carry was a
                      // second, fainter statement of the shade already filling
                      // the pill — on a badge this small it thickened the
                      // silhouette without adding a reading, and it put a
                      // stroke back on a card that now has none.
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: sColor.withValues(alpha: 0.16),
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentStatusInfo.label(incident.status),
                          style: _t(
                              size: 10.5,
                              weight: FontWeight.w700,
                              letterSpacing: 0.2,
                              color: sColor),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _relative(incident.reportedAt),
                        style: _t(size: 11, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ],
              ),
              ReportStatusTracker(status: incident.status),
              Row(
                children: [
                  const Icon(PhosphorIconsFill.mapPin,
                      size: 13, color: AppColors.textMuted),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      incident.location,
                      style: _t(size: 12, color: AppColors.textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'View Timeline',
                        style: _t(
                            size: 11.5,
                            weight: FontWeight.w600,
                            color: AppColors.primary),
                      ),
                      const SizedBox(width: 2),
                      const Icon(AppIcons.chevronRight,
                          size: 14, color: AppColors.primary),
                    ],
                  ),
                ],
              ),
            ],
      ),
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
