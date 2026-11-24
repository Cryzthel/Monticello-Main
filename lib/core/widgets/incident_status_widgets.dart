// Incident progress UI: the report status tracker and the status timeline.
// Split out of shared_widgets.dart (2026-10-20), which re-exports it.

import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';

/// ─────────────────────── REPORT STATUS TRACKER ───────────────────────
/// The horizontal four-step progress rail on a History card.
///
/// ── HOW MANY STEPS ARE DONE ───────────────────────────────────────────────
/// [IncidentStatusTracking.trackingStep] answers "which step is the report ON",
/// which is NOT the same question as "how many are finished", and reading one
/// as the other is what left a resolved report showing three checks and a live
/// step 4. `resolved` maps to step 3 — the last index — so under `idx < step`
/// the final node was permanently the ACTIVE one: a filled circle with the
/// numeral 4 in it, sitting there indefinitely on a report that was closed
/// weeks ago. The timeline never visibly completed.
///
/// So the two are computed separately. [_completed] is the count of finished
/// steps, and for a terminal state that is all four; `trackingStep` still marks
/// the live node, and a report that has completed has no live node at all.
///
/// `falseAlarm` is terminal but does NOT complete, and needs both halves of
/// that to be drawn right. It shares step 3 with `resolved`, but a report
/// withdrawn as a mistake did not travel the four stages — completing it would
/// claim a resolution that never happened — and it is not working through the
/// fourth either, so the step is neither done nor live. It renders as what it
/// is: three steps behind it and a pending fourth that will never fill.
class ReportStatusTracker extends StatelessWidget {
  final IncidentStatus status;

  const ReportStatusTracker({super.key, required this.status});

  static const _labels = ['Submitted', 'Verified', 'In Progress', 'Resolved'];

  static const _stepCount = 4;

  // ── ONE SET OF NUMBERS, NO PER-CARD OVERRIDES ────────────────────────────
  //
  // Every dimension of this rail is fixed here. It is the same indicator on
  // every card in a scrolling feed, and a feed is exactly where a few pixels
  // of drift between neighbours is visible — the eye reads a column of rails
  // against each other, not against a spec.

  /// Diameter of one step node. Read by the rail geometry as well as the discs
  /// themselves — see [build] — so the two cannot disagree about how much of a
  /// step column the node occupies.
  static const double _nodeSize = 26;

  /// Thickness of the rail running between two nodes.
  ///
  /// Two, not 2.5. A half-pixel rule lands on a fractional device pixel at
  /// every common ratio (7.5 physical px at 3x), so it is anti-aliased into a
  /// soft three-pixel smear instead of a crisp line — on the one element in
  /// this widget whose whole job is to be a clean straight edge.
  static const double _railHeight = 2;

  /// Clearance between a node's edge and the rail that runs into it.
  static const double _railInset = 4;

  /// The block's own vertical margin inside a card.
  ///
  /// Fixed, not a constructor argument. It used to be `verticalPadding + 6`,
  /// where the argument defaulted to 4 and the History card passed 10 — so the
  /// rail's vertical rhythm depended on which call site built it, and on a
  /// hidden +6 that was invisible from the call. One number, on the 8px grid.
  static const double _blockPadding = 16;

  /// Gap between the node row and the label row beneath it.
  static const double _labelGap = 8;

  /// Stroke weight of the check inside a completed node.
  ///
  /// Stated rather than inherited: [CheckmarkPainter]'s default is a ratio
  /// tuned for the report wizard's large confirmation badge, and at 26px it
  /// resolves to 2.9px — a tick that thick inside a disc this small closes up
  /// its own inner angle and reads as a smudge.
  static const double _checkStroke = 2.4;

  /// Number of steps behind the resident, 0–4. Only a report that ran the
  /// full course has four — see [IncidentLifecycle].
  int get _completed => status.isComplete ? _stepCount : status.trackingStep;

  /// The step currently underway, or null once nothing is.
  int? get _live => status.isTerminal ? null : status.trackingStep;

  /// One step's disc.
  ///
  /// ── NOTHING BUT A DISC ────────────────────────────────────────────────────
  ///
  /// Every node used to carry `border: 2px` regardless of state, and on a done
  /// node that border was drawn in the SAME emerald as the fill — 2px of colour
  /// outside 20px of the identical colour, which did nothing but grow the dot
  /// and coarsen the check inside it. Worse, it was a stroke on a card that has
  /// none, so four little outlined boxes marched across an otherwise borderless
  /// surface.
  ///
  /// A completed step is exactly one thing: a solid emerald disc with a white
  /// check. The ring survives only where it is load-bearing — a PENDING node,
  /// which is an empty circle on white and would not exist without its edge.
  ///
  /// ── THE CHECK IS PAINTED, NOT A GLYPH ─────────────────────────────────────
  ///
  /// It was `Icon(PhosphorIconsFill.check)`, and an [Icon] is text: it asks the
  /// font stack for one character and draws whatever comes back. When an icon
  /// font has not resolved, what comes back is the missing-glyph box — a hollow
  /// SQUARE, drawn in the icon's colour, sitting inside the circle. That is the
  /// one way a square could still appear here after the container behind these
  /// nodes was removed, and it is not a possibility worth leaving open on the
  /// History screen's most-read indicator.
  ///
  /// [CheckmarkPainter] is a path, so it cannot fail that way. It is also
  /// already what the report wizard's step indicator draws, which makes the two
  /// step trackers in this app agree on what a completed step looks like
  /// instead of merely resembling one another.
  ///
  /// Sized to fill the disc, DELIBERATELY: [CheckmarkPainter] insets its own
  /// tick to the middle ~50% of the box it is given, so painting at the full
  /// 26px node diameter is what produces a ~13px check with clearance all
  /// round. The box is stated on the CustomPaint rather than inherited from
  /// the parent's tight constraints, so resizing the node resizes the mark
  /// with it instead of silently rescaling one and not the other.
  ///
  /// [CheckmarkPainter.boundsFor] measures what that actually puts on the
  /// canvas, and a test holds those bounds inside the disc.
  Widget _stepNode(int index) {
    final isDone = index < _completed;
    final isActive = index == _live;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOut,
      width: _nodeSize,
      height: _nodeSize,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isDone
            ? AppColors.ctaGreen
            : (isActive ? AppColors.primary : AppColors.surface),
        border: isDone || isActive
            ? null
            : Border.all(color: AppColors.borderNeutralStrong, width: 1.5),
        // Neutral — see AppShadows. Was the active colour at 30%.
        boxShadow: isActive ? AppShadows.sm : null,
      ),
      child: isDone
          ? Center(
              child: CustomPaint(
                size: const Size.square(_nodeSize),
                painter: CheckmarkPainter(
                  color: AppColors.onAccent,
                  // Fully drawn. The stroke-on animation belongs to the wizard,
                  // where a step completes under the resident's eyes; here it
                  // would replay on every card that scrolls back into view.
                  progress: 1,
                  strokeWidth: _checkStroke,
                ),
              ),
            )
          : Center(
              child: Text(
                '${index + 1}',
                style: sfPro(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: isActive ? AppColors.onAccent : AppColors.textMuted,
                ),
              ),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // ── ONE COLUMN PER STEP, NOT NODES-AND-GAPS ──────────────────────────────
    //
    // The rail was laid out as `node, Expanded(rail), node, …` while the labels
    // underneath were four equal [Expanded] cells. Those are two different
    // grids and they do not line up: the discs are fixed-width and the gaps
    // absorb every pixel of slack, so on a width W the node centres fall at
    // 13, W/3 + 4.3, 2W/3 − 4.3 and W − 13, while the label cells centre at
    // W/8, 3W/8, 5W/8 and 7W/8. The two middle labels sat ~8px off the nodes
    // they name, and the outer two were aligned to the CARD's edge rather than
    // to a node — "Submitted" started 13px to the left of the disc above it.
    //
    // Both rows now derive from one number: the width cut into four equal step
    // columns. The disc is centred in its column and the label is centred in
    // the same column, so a label sitting under its own node is a consequence
    // of the layout instead of a coincidence maintained by hand.
    //
    // The rails span BETWEEN column centres, which is why they are positioned
    // rather than laid out in the row: a rail belongs to the gap between two
    // steps, and a gap is not a step.
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: _blockPadding),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final column = constraints.maxWidth / _stepCount;
          double centreOf(int step) => column * (step + 0.5);
          // Floored at zero: a [Positioned] with a negative width asserts out
          // of layout, and a column narrower than a node plus its clearances
          // is not worth taking the whole card down for.
          final railWidth =
              math.max(0.0, column - _nodeSize - _railInset * 2);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: _nodeSize,
                child: Stack(
                  children: [
                    // Rails first, so a disc always paints over the line that
                    // runs into it.
                    for (var i = 0; i < _stepCount - 1; i++)
                      Positioned(
                        left: centreOf(i) + _nodeSize / 2 + _railInset,
                        width: railWidth,
                        top: (_nodeSize - _railHeight) / 2,
                        height: _railHeight,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 260),
                          curve: Curves.easeOut,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(2),
                            // Filled once the node to its LEFT is behind the
                            // resident, so the rail fills up to where they
                            // are rather than waiting on the step ahead.
                            //
                            // No glow on a 2.5px connector line. A completed
                            // segment is already the done colour against a
                            // grey one; a bloom around a hairline just blurs
                            // the hairline.
                            color: _completed > i
                                ? AppColors.ctaGreen
                                : AppColors.borderNeutralStrong,
                          ),
                        ),
                      ),
                    for (var i = 0; i < _stepCount; i++)
                      Positioned(
                        left: centreOf(i) - _nodeSize / 2,
                        top: 0,
                        child: _stepNode(i),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: _labelGap),
              Row(
                children: List.generate(_stepCount, (i) {
                  final isDone = i < _completed;
                  final isActive = i == _live;
                  // Centred, every one of them. Aligning the first label left
                  // and the last right is what a label row needs when its
                  // cells do NOT match the node positions — and is exactly
                  // what throws it off once they do.
                  return Expanded(
                    child: Text(
                      _labels[i],
                      textAlign: TextAlign.center,
                      style: sfPro(
                        fontSize: 9.5,
                        fontWeight:
                            isActive ? FontWeight.w700 : FontWeight.w500,
                        letterSpacing: 0.2,
                        color: isDone || isActive
                            ? AppColors.textPrimary
                            : AppColors.textMuted,
                      ),
                    ),
                  );
                }),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// ─────────────────────── INCIDENT STATUS TIMELINE ───────────────────────
/// Vertical 4-node timeline showing the full lifecycle of an incident report.
/// Past nodes glow Emerald Green, the active node pulses, pending nodes are
/// desaturated slate. Used inside the incident detail bottom sheet.
class IncidentStatusTimeline extends StatefulWidget {
  final Incident incident;

  const IncidentStatusTimeline({super.key, required this.incident});

  @override
  State<IncidentStatusTimeline> createState() => _IncidentStatusTimelineState();
}

class _IncidentStatusTimelineState extends State<IncidentStatusTimeline>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseCtrl;
  late Animation<double> _pulseAnim;

  // ── THE GRID ─────────────────────────────────────────────────────────────
  //
  // Four numbers set the whole vertical rhythm, and every gap in the stage
  // body is a multiple of four. They are named because the rail and the prose
  // beside it have to agree about where a stage starts and ends, and a
  // literal buried in one of the two columns is how they stopped agreeing
  // last time.

  /// Width of the rail column. Sized to the active node's halo, so a stage
  /// going live does not shove the text column sideways.
  static const double _railColumn = 28;

  /// Height of the box the dot is centred in — and, on the other side of the
  /// gutter, the box the stage label is centred in. One number for both is
  /// what puts a dot and its label on a shared centre line.
  static const double _dotSlot = 22;

  static const double _dotSize = 18;
  static const double _haloSize = 28;
  static const double _dotIconSize = 10;

  /// Gap between the rail column and the text column.
  static const double _gutter = 14;

  /// Vertical gap between one stage's content and the next stage's label.
  static const double _stageGap = 24;

  static const double _lineWidth = 2;

  /// Clearance between the connector and the dots at either end of it.
  static const double _lineInset = 6;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat(reverse: true);
    _pulseAnim = Tween<double>(begin: 0.55, end: 1.0).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    super.dispose();
  }

  static const _nodes = [
    _TimelineNode(
      label: 'Report Submitted',
      sublabel: 'Ticket initialized and queued',
      icon: PhosphorIconsFill.uploadSimple,
    ),
    _TimelineNode(
      label: 'Verified by Security',
      sublabel: 'Guard has acknowledged the report',
      icon: PhosphorIconsFill.shieldCheck,
    ),
    _TimelineNode(
      label: 'Dispatched / In Progress',
      sublabel: 'Responding personnel are active',
      icon: PhosphorIconsFill.personSimpleRun,
    ),
    _TimelineNode(
      label: 'Resolved',
      sublabel: 'Incident has been closed',
      icon: PhosphorIconsFill.checkCircle,
    ),
  ];

  /// Server-verified timestamp for a timeline node, or null when the backend
  /// has no real time for that stage. Deliberately returns null rather than
  /// deriving a plausible-looking value — this chip previously rendered
  /// `reportedAt + (nodeIndex * 2 hours)`, which showed residents dispatch
  /// times that never happened.
  DateTime? _timestampForNode(int index) {
    switch (index) {
      case 0:
        return widget.incident.reportedAt;
      case 2:
        return widget.incident.dispatchedAt;
      case 3:
        return widget.incident.resolvedAt;
      default:
        // "Verified by Security" has no dedicated timestamp in the schema.
        return null;
    }
  }

  /// Prefers the real responder's name (written by the web command centers)
  /// over the node's generic placeholder copy.
  String _sublabelForNode(int index, _TimelineNode node, bool isPending, bool isActive) {
    if (isPending) return 'Pending';
    final guard = widget.incident.assignedGuardName;
    if (index == 2 && guard.isNotEmpty) {
      return isActive ? 'Responding: $guard' : 'Responded by $guard';
    }
    return isActive ? 'In progress…' : node.sublabel;
  }

  @override
  Widget build(BuildContext context) {
    final status = widget.incident.status;
    // Same distinction the horizontal tracker draws, for the same reason: a
    // report that has stopped moving has no live node. Without this the last
    // node stayed "active" forever — pulsing, and captioned "Now" — on an
    // incident that closed weeks ago, which is the one node a resident opens
    // this sheet to check. See [IncidentLifecycle] for why `falseAlarm` stops
    // without completing.
    final activeStep = status.trackingStep;
    final completed = status.isComplete ? _nodes.length : activeStep;
    final textPrimary = AppColors.onGlassPrimary;
    final textSecondary = AppColors.onGlassSecondary;
    final doneColor = AppColors.success;
    // Slate, not white-at-22%. That value was legible only against the dark
    // glass sheet this timeline used to sit on; on the white panel it now
    // renders into, a pending node was drawn in white on white and simply did
    // not exist. Same for the resolution note fill below.
    final pendingColor = AppColors.borderNeutralStrong;
    final lineColorDone = AppColors.success.withValues(alpha: 0.70);
    final lineColorPending = AppColors.borderNeutral;

    // ── ONE ROW PER STAGE, AND THE LINE IS WHAT IS LEFT OVER ─────────────────
    //
    // The rail column and the text column used to be laid out independently:
    // the connector was `height: 56`, hard-coded, while the text beside it was
    // whatever its content came to plus 28px of bottom padding. Those two
    // numbers only agree for one particular combination of label, sublabel and
    // timestamp chip, and no stage has that combination reliably — the resolved
    // stage carries a wrapped resolution note, a pending stage carries one
    // word. So the line under-ran the next dot on a tall stage and over-ran it
    // on a short one, and the gap moved as the report progressed.
    //
    // [IntrinsicHeight] makes the row as tall as its tallest child, and the
    // connector then takes an [Expanded] share of the rail column: whatever is
    // left after the dot. The line therefore runs dot-to-dot by construction at
    // every content height, which is what "grid-aligned" has to mean for a rail
    // whose spacing is set by prose it does not control.
    //
    // IntrinsicHeight is a two-pass layout and normally worth avoiding. Four
    // rows in a bottom sheet is not where that cost shows up, and the
    // alternative is a magic number that is wrong for three stages out of four.
    return Column(
      children: List.generate(_nodes.length, (i) {
        final node = _nodes[i];
        final isDone = i < completed;
        final isActive = !status.isTerminal && i == activeStep;
        final isPending = !isDone && !isActive;
        final isLast = i == _nodes.length - 1;
        final timestamp = _timestampForNode(i);
        final showChip = isActive || (isDone && timestamp != null);
        final showResolution =
            isLast && widget.incident.status == IncidentStatus.resolved;

        final dotColor = isDone || isActive ? doneColor : pendingColor;

        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Left column: dot, then the line that fills the rest ───────
              SizedBox(
                width: _railColumn,
                child: Column(
                  children: [
                    SizedBox(
                      height: _dotSlot,
                      child: Center(
                        child: AnimatedBuilder(
                          animation: _pulseAnim,
                          builder: (_, __) => Stack(
                            alignment: Alignment.center,
                            children: [
                              if (isActive)
                                Container(
                                  width: _haloSize,
                                  height: _haloSize,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: doneColor.withValues(
                                        alpha: 0.22 * _pulseAnim.value),
                                  ),
                                ),
                              Container(
                                width: _dotSize,
                                height: _dotSize,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: dotColor,
                                  // Neutral. The PULSE is not lost with the
                                  // glow — it lives in the expanding halo
                                  // directly above, which is a fill, not a
                                  // shadow. This shadow was pulsing in the same
                                  // colour on top of that, doubling the
                                  // animation in the brand hue.
                                  boxShadow: (isDone || isActive)
                                      ? AppShadows.sm
                                      : null,
                                ),
                                child: Icon(
                                  isPending
                                      ? PhosphorIconsFill.circle
                                      : node.icon,
                                  size: _dotIconSize,
                                  color: isPending
                                      ? AppColors.onGlassMuted
                                      : Colors.white,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (!isLast)
                      Expanded(
                        child: Center(
                          child: Container(
                            width: _lineWidth,
                            margin: const EdgeInsets.symmetric(
                                vertical: _lineInset),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(_lineWidth),
                              color: isDone ? lineColorDone : lineColorPending,
                              gradient: isDone
                                  ? LinearGradient(
                                      begin: Alignment.topCenter,
                                      end: Alignment.bottomCenter,
                                      colors: [
                                        doneColor.withValues(alpha: 0.80),
                                        isActive
                                            ? doneColor.withValues(alpha: 0.20)
                                            : doneColor.withValues(alpha: 0.55),
                                      ],
                                    )
                                  : null,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),

              const SizedBox(width: _gutter),

              // ── Right column: label, sublabel, timestamp ──────────────────
              //
              // Every gap in here is a multiple of four, and the label sits in
              // a box of exactly [_dotSlot] — the same box the dot is centred
              // in — so the first line of type and the dot beside it share a
              // centre line rather than approximately agreeing. The stray 1px
              // SizedBox that used to nudge the label down is gone with it.
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(bottom: isLast ? 0 : _stageGap),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        height: _dotSlot,
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            node.label,
                            style: sfPro(
                              fontSize: 14,
                              height: 1.2,
                              fontWeight: isActive || isDone
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              color: isPending ? textSecondary : textPrimary,
                            ),
                          ),
                        ),
                      ),
                      Text(
                        _sublabelForNode(i, node, isPending, isActive),
                        style: sfPro(
                          fontSize: 12,
                          height: 1.35,
                          color: isActive
                              ? doneColor
                              : (isPending
                                  ? AppColors.onGlassMuted
                                  : textSecondary),
                          fontWeight:
                              isActive ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
                      // Only rendered when there's a real server timestamp to
                      // show (or the stage is live) — a completed stage with no
                      // recorded time simply shows no chip rather than a
                      // made-up one.
                      if (showChip) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: doneColor.withValues(alpha: 0.10),
                            borderRadius: BorderRadius.circular(AppRadius.pill),
                          ),
                          child: Text(
                            isActive
                                ? 'Now'
                                : DateFormat('MMM d • h:mm a')
                                    .format(timestamp!),
                            style: sfPro(
                              fontSize: 10.5,
                              height: 1.2,
                              fontWeight: FontWeight.w600,
                              color: doneColor,
                            ),
                          ),
                        ),
                      ],
                      if (showResolution) ...[
                        const SizedBox(height: 12),
                        // Fill only — the 35%-alpha emerald outline this had
                        // was a box drawn around a note that the tint already
                        // separates from the page.
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.success.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(AppRadius.lg),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(PhosphorIconsFill.notepad,
                                  size: 14, color: doneColor),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Resolution notes: Issue has been fully '
                                  'addressed by the HOA security team.',
                                  style: sfPro(
                                    fontSize: 12,
                                    color: textSecondary,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      }),
    );
  }
}

class _TimelineNode {
  final String label;
  final String sublabel;
  final IconData icon;
  const _TimelineNode({
    required this.label,
    required this.sublabel,
    required this.icon,
  });
}

/// ─────────────────────── REPORT DELETION ───────────────────────
///
/// Split into three pieces rather than the one `confirmDeleteReport` that used
/// to do all of it, because the swipe gesture needs them at different moments:
/// [Dismissible] asks for a yes/no BEFORE it animates the row away
/// (`confirmDismiss`) and only reports the deletion AFTER (`onDismissed`), so
/// the question and the write cannot stay welded together.
///
///   [confirmReportDeletion]  asks, answers bool, touches nothing
///   [deleteReport]           writes, reports success, asks nothing
///   [confirmDeleteReport]    both, for the long-press path
///
/// The permission check sits in front of all three — see [IncidentLifecycle].
