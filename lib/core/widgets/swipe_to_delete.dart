import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';

/// Instagram-style swipe-to-delete for a card in a list.
///
/// ── WHY A WRAPPER AND NOT A BARE Dismissible ────────────────────────────────
/// The trash icon has to answer the finger. [Dismissible] reports how far the
/// row has travelled through `onUpdate`, but that value is only useful to a
/// widget that can rebuild on it — so this owns a [ValueNotifier] and rebuilds
/// ONLY the plate behind the card. Routing the same value through setState
/// would rebuild the card, its chips and its menus on every frame of a drag.
///
/// The travel itself costs nothing either way: Dismissible moves the row with a
/// [FractionalTranslation], which is a composited transform, so the drag stays
/// on the GPU no matter what the plate behind it is doing.
class SwipeToDelete extends StatefulWidget {
  const SwipeToDelete({
    required Key key,
    required this.child,
    required this.onDismissed,
    this.confirmDismiss,
  }) : super(key: key);

  final Widget child;
  final VoidCallback onDismissed;

  /// Asked once the row is released past [threshold], BEFORE it animates away.
  /// Returning false springs it back and [onDismissed] never fires.
  ///
  /// ── WHY THE PROMPT BELONGS HERE AND NOT IN onDismissed ────────────────────
  /// A notification is a copy of something that happened; a swipe removing one
  /// needs no ceremony. An incident report is the resident's only record of a
  /// request they made to the HOA, and its photo evidence goes with it — so
  /// that one asks first.
  ///
  /// The two cannot share `onDismissed` for the question, because by then the
  /// row is already gone from the list. A prompt raised at that point would be
  /// asking about something the interface has visibly finished doing, and a
  /// "Cancel" would have to animate the row back in — which reads as an undo,
  /// not as a question. `confirmDismiss` fires while the row is still held
  /// open at the threshold, so Cancel simply lets it fall back into place.
  final Future<bool> Function()? confirmDismiss;

  /// How far the row must travel, as a fraction of its width, to commit.
  ///
  /// 0.42 rather than Flutter's 0.4 default, and well short of Instagram's
  /// near-half-screen: a notification list is scrolled fast and vertically, so
  /// the threshold has to sit past the range a diagonal scroll flick can reach,
  /// without demanding a deliberate drag across the whole card.
  static const double threshold = 0.42;

  @override
  State<SwipeToDelete> createState() => _SwipeToDeleteState();
}

class _SwipeToDeleteState extends State<SwipeToDelete> {
  /// 0 at rest, 1 when the row has travelled its full width.
  final ValueNotifier<double> _progress = ValueNotifier<double>(0);

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: ValueKey('swipe-${widget.key}'),
      // Left only. A two-way swipe on a card with no second action just makes
      // the row feel loose, and right-to-left is the direction every mail and
      // chat app has already taught.
      direction: DismissDirection.endToStart,
      dismissThresholds: const {
        DismissDirection.endToStart: SwipeToDelete.threshold,
      },
      // Snappier than the 200ms default in both directions. A row that takes a
      // fifth of a second to spring back reads as laggy next to the finger that
      // has already let go of it.
      movementDuration: const Duration(milliseconds: 160),
      resizeDuration: const Duration(milliseconds: 220),
      onUpdate: (details) => _progress.value = details.progress,
      confirmDismiss: widget.confirmDismiss == null
          ? null
          : (_) async {
              final confirmed = await widget.confirmDismiss!();
              // The plate is driven by `onUpdate`, which stops firing while a
              // dialog is up and does not resume on the spring-back. Left as
              // it was, a cancelled swipe would settle the row over a plate
              // still lit at full travel, ready to flash on the next scroll.
              if (!confirmed) _progress.value = 0;
              return confirmed;
            },
      onDismissed: (_) => widget.onDismissed(),
      background: ValueListenableBuilder<double>(
        valueListenable: _progress,
        builder: (context, progress, _) => SwipeDeletePlate(progress: progress),
      ),
      child: widget.child,
    );
  }
}

/// The rose plate revealed behind a swiping card.
///
/// The icon does not simply sit there. It scales up as the row travels and
/// settles at full size exactly as the release threshold is crossed, so the
/// gesture confirms it has committed BEFORE the finger lifts — which is the
/// whole reason Instagram's version feels decisive where a static plate does
/// not.
class SwipeDeletePlate extends StatelessWidget {
  const SwipeDeletePlate({super.key, required this.progress});

  /// Travel as reported by [Dismissible.onUpdate]: 0 at rest, 1 at full width.
  final double progress;

  @override
  Widget build(BuildContext context) {
    // Normalised against the COMMIT point, not the full width, so the icon is
    // at rest precisely when releasing would delete.
    final t = (progress / SwipeToDelete.threshold).clamp(0.0, 1.0);
    // easeOutBack overshoots just past 1 and settles — the small pop that marks
    // the threshold without needing a separate animation to announce it.
    final scale = 0.62 + (Curves.easeOutBack.transform(t) * 0.38);

    return Container(
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.only(right: 24),
      decoration: BoxDecoration(
        color: AppColors.swipeDelete,
        borderRadius: AppCard.borderRadius,
      ),
      child: Opacity(
        // Fades in over the first third of the travel, so a scroll that nudges
        // the row a few pixels does not flash a delete icon at the resident.
        opacity: (t * 3).clamp(0.0, 1.0),
        child: Transform.scale(
          scale: scale,
          child: const Icon(
            // Lucide's Trash2 is the lidded bin with vertical strokes. This is
            // Phosphor's equivalent — Lucide is not a dependency here.
            PhosphorIconsFill.trash,
            size: 24,
            color: AppColors.onAccent,
          ),
        ),
      ),
    );
  }
}
