import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart'
    show AnimatedCheckmark;
import 'package:monticello_villas_app/features/panic_button/services/panic_alert_service.dart';

/// Opens the emergency countdown over whatever the resident was doing.
///
/// The sheet arms ITSELF. Tapping SOS is the trigger — there is no second
/// button to press inside, because a resident reaching for the panic control
/// has already decided, and asking them to confirm on a screen they have never
/// seen before is asking them to read during an emergency. The five seconds are
/// the confirmation, and they run in the resident's favour: doing nothing sends
/// the alert, and only a deliberate hold stops it.
///
/// [dispatcher] exists for tests, which must be able to drive the whole timing
/// and cancellation flow without a Firebase app or a GPS fix.
Future<void> showSosCountdown(
  BuildContext context, {
  Future<SosDispatchOutcome> Function()? dispatcher,
}) {
  return showModalBottomSheet<void>(
    context: context,
    // None of the usual escape hatches. A barrier tap, a downward drag or a
    // back gesture must not abort an alert that is already counting down —
    // those are exactly the motions a phone makes in a pocket or a struggle.
    // The hold-to-cancel control is the only way out, and that is on purpose.
    isDismissible: false,
    enableDrag: false,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _SosCountdownSheet(
      dispatcher: dispatcher ?? PanicAlertService.dispatch,
    ),
  );
}

/// `queued` is a success state, not a failure one — the alert is on disk and
/// the sync service owns it from here. It is separate from `sent` only so the
/// sheet can avoid claiming the guardhouse has seen something it has not.
enum _Phase { counting, sending, sent, queued, failed }

class _SosCountdownSheet extends StatefulWidget {
  const _SosCountdownSheet({required this.dispatcher});

  final Future<SosDispatchOutcome> Function() dispatcher;

  @override
  State<_SosCountdownSheet> createState() => _SosCountdownSheetState();
}

class _SosCountdownSheetState extends State<_SosCountdownSheet>
    with TickerProviderStateMixin {
  /// Grace period before the alert goes out.
  static const Duration countdown = Duration(seconds: 5);

  /// How long "cancel" has to be held.
  static const Duration holdToCancel = Duration(seconds: 1);

  /// ONE clock for both the ring and the digit.
  ///
  /// A `Timer.periodic` for the number plus an animation for the ring is two
  /// clocks that drift apart within a second or two, and the resident then
  /// watches a ring that is nearly empty above a digit that still says 2.
  /// Everything here derives from this controller's value.
  late final AnimationController _clock;

  /// Drives the cancel button's fill while held.
  late final AnimationController _hold;

  /// Slow pulse behind the ring — the only purely decorative animation here.
  late final AnimationController _pulse;

  _Phase _phase = _Phase.counting;
  int _lastTick = 5;

  /// Set the moment a cancel is accepted, before the pop actually happens.
  /// Without it a second hold landing in the same frame could pop twice.
  bool _closing = false;

  int get _secondsLeft =>
      (countdown.inSeconds * (1 - _clock.value)).ceil().clamp(0, countdown.inSeconds);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Reduced motion: the halo and the dot hold still. The countdown ring and
    // the number still count — they are the information, not decoration.
    if (MediaQuery.disableAnimationsOf(context)) {
      _pulse.stop();
      _pulse.value = 0;
    } else if (!_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void initState() {
    super.initState();

    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);

    _hold = AnimationController(vsync: this, duration: holdToCancel)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _cancel();
      });

    _clock = AnimationController(vsync: this, duration: countdown)
      ..addListener(_onTick)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _dispatch();
      });

    // A firm tap the instant the sheet appears, so the resident knows the
    // trigger registered before they have looked at the screen.
    HapticFeedback.heavyImpact();
    _clock.forward();
  }

  void _onTick() {
    final left = _secondsLeft;
    if (left == _lastTick) return;
    _lastTick = left;
    if (left > 0) {
      // One tick per second — the tactile metronome that tells a resident the
      // alert is still coming while the phone is at their side.
      HapticFeedback.mediumImpact();
    }
    setState(() {});
  }

  @override
  void dispose() {
    _clock.dispose();
    _hold.dispose();
    _pulse.dispose();
    super.dispose();
  }

  void _cancel() {
    if (_phase != _Phase.counting || _closing) return;
    _closing = true;
    _clock.stop();
    HapticFeedback.heavyImpact();

    // Popped AFTER the frame, not inside the hold controller's status
    // listener. Tearing the sheet down mid-callback disposes the very
    // AnimationController that is still notifying its listeners, and the
    // finger has not lifted yet — the button's onTapUp would then reverse a
    // disposed controller.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  Future<void> _dispatch() async {
    if (!mounted) return;
    setState(() => _phase = _Phase.sending);
    try {
      final outcome = await widget.dispatcher();
      if (!mounted) return;
      setState(() => _phase = outcome == SosDispatchOutcome.delivered
          ? _Phase.sent
          : _Phase.queued);
      HapticFeedback.heavyImpact();
    } catch (_) {
      if (!mounted) return;
      setState(() => _phase = _Phase.failed);
      HapticFeedback.heavyImpact();
    }
  }

  Future<void> _retry() async {
    setState(() => _phase = _Phase.sending);
    await _dispatch();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Same reasoning as the barrier: a back gesture must not silently abort
      // an alert. Once dispatched the sheet pops normally via Done.
      canPop: _phase == _Phase.sent ||
          _phase == _Phase.queued ||
          _phase == _Phase.failed,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.fromLTRB(
            24, 18, 24, 24 + MediaQuery.of(context).padding.bottom),
        decoration: const BoxDecoration(
          color: AppColors.backgroundSecondary,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
          border: Border(
            top: BorderSide(color: AppColors.glassBorderLight),
          ),
        ),
        // ── LEFT-ALIGNED, TOP TO BOTTOM ────────────────────────────────────
        // Header, dial and caption share one left edge. The sheet used to
        // centre all three, which made the caption — two or three lines of
        // instructions read under stress — a ragged block with no edge for
        // the eye to return to. A left rag reads faster, and the dial
        // sitting on the same edge keeps the column one shape.
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(),
            const SizedBox(height: 20),
            _dial(),
            const SizedBox(height: 20),
            _caption(),
            const SizedBox(height: 24),
            _action(),
          ],
        ),
      ),
    );
  }

  /// One place deciding what colour the outcome is, so the glyph and the label
  /// cannot end up disagreeing about whether the alert got through.
  Color get _outcomeTint => switch (_phase) {
        _Phase.sent => AppColors.success,
        _Phase.queued => AppColors.warning,
        _ => AppColors.panicOxblood,
      };

  Widget _header() {
    final counting = _phase == _Phase.counting;
    return Row(
      children: [
        Icon(
          switch (_phase) {
            _Phase.sent => PhosphorIconsFill.shieldCheck,
            _Phase.queued => PhosphorIconsFill.cloudSlash,
            _ => PhosphorIconsFill.siren,
          },
          size: 18,
          color: _outcomeTint,
        ),
        const SizedBox(width: 8),
        Text(
          switch (_phase) {
            _Phase.counting => 'EMERGENCY ALERT',
            _Phase.sending => 'SENDING ALERT',
            _Phase.sent => 'SECURITY NOTIFIED',
            _Phase.queued => 'SAVED — NO SIGNAL',
            _Phase.failed => 'ALERT NOT SENT',
          },
          style: sfPro(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.2,
            color: _outcomeTint,
          ),
        ),
        if (counting) ...[
          const SizedBox(width: 8),
          FadeTransition(
            opacity: Tween<double>(begin: 0.25, end: 1).animate(_pulse),
            child: const DecoratedBox(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.panicOxblood,
              ),
              child: SizedBox(width: 7, height: 7),
            ),
          ),
        ],
      ],
    );
  }

  /// The countdown ring, or the outcome glyph once the alert has resolved.
  Widget _dial() {
    if (_phase == _Phase.sent ||
        _phase == _Phase.queued ||
        _phase == _Phase.failed) {
      final ok = _phase != _Phase.failed;
      final tint = _outcomeTint;
      // Smaller than the countdown ring: the number was the thing to read,
      // the outcome is the title and caption, and the badge only confirms it.
      //
      // The check is DRAWN (AnimatedCheckmark), not the Phosphor glyph it
      // replaces. The glyph's artwork sits low and left of its own em box,
      // so in a circle it looked dropped off-centre; a stroked path is
      // centred by construction, and drawing itself on (~380ms) is the one
      // moment of motion that says "this just happened".
      return Container(
        width: 88,
        height: 88,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: tint.withValues(alpha: 0.12),
          border: Border.all(color: tint, width: 2),
        ),
        child: ok
            ? AnimatedCheckmark(color: tint, size: 40)
            : Icon(PhosphorIconsBold.warning, size: 38, color: tint),
      );
    }

    return AnimatedBuilder(
      animation: Listenable.merge([_clock, _pulse]),
      builder: (context, _) {
        return SizedBox(
          width: 132,
          height: 132,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Pulsing halo, sized off the pulse controller so it breathes.
              Container(
                width: 118 + (_pulse.value * 14),
                height: 118 + (_pulse.value * 14),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.panicOxblood
                      .withValues(alpha: 0.10 * (1 - _pulse.value)),
                ),
              ),
              CustomPaint(
                size: const Size(132, 132),
                painter: _RingPainter(progress: 1 - _clock.value),
              ),
              if (_phase == _Phase.sending)
                // The app's one waiting mark, so "sending" on the emergency
                // sheet looks like every other wait the resident has seen.
                const LeafLoader(size: 34, color: AppColors.panicOxblood)
              else
                Text(
                  '$_secondsLeft',
                  style: sfPro(
                    fontSize: 54,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    height: 1,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _caption() {
    final text = switch (_phase) {
      _Phase.counting =>
        'Alerting security in $_secondsLeft second${_secondsLeft == 1 ? '' : 's'}.\n'
            'Your location and property details will be sent.',
      _Phase.sending => 'Sending your location and property details…',
      // "en route" was a claim this sheet cannot make — the write landing in
      // Firestore says a record exists, not that anyone has read it or left
      // the guardhouse. Same problem the panic screen's fabricated "ETA 2
      // minutes" had, and the same fix: say what happened.
      _Phase.sent =>
        'Security has your alert, with your location and property details.\n'
            'Stay where you are if it is safe to do so.',
      _Phase.queued =>
        'No signal. Your alert is saved on this phone, encrypted, and will '
            'send itself as soon as you are back in range.\n'
            'The guardhouse has not seen it yet — call the hotline if you can.',
      _Phase.failed =>
        'The alert could not be sent. Check your connection and try again, '
            'or call the security hotline.',
    };

    return Text(
      text,
      textAlign: TextAlign.left,
      style: sfPro(
        fontSize: 15,
        color: AppColors.textPrimary,
        height: 1.45,
      ),
    );
  }

  Widget _action() {
    switch (_phase) {
      case _Phase.counting:
        return _HoldToCancelButton(hold: _hold);
      case _Phase.sending:
        return const SizedBox(height: 54);
      case _Phase.sent:
        return _FlatButton(
          label: 'Done',
          background: AppColors.success,
          foreground: AppColors.background,
          onTap: () => Navigator.of(context).pop(),
        );
      case _Phase.queued:
        return _FlatButton(
          label: 'Done',
          background: AppColors.warning,
          foreground: AppColors.background,
          onTap: () => Navigator.of(context).pop(),
        );
      case _Phase.failed:
        return Row(
          children: [
            Expanded(
              child: _FlatButton(
                label: 'Close',
                background: AppColors.backgroundElevated,
                foreground: AppColors.textSecondary,
                onTap: () => Navigator.of(context).pop(),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _FlatButton(
                label: 'Try again',
                background: AppColors.panicOxblood,
                foreground: Colors.white,
                onTap: _retry,
              ),
            ),
          ],
        );
    }
  }
}

/// Cancel, guarded by a one-second hold.
///
/// A plain tap would be the wrong control here. The failure that matters is not
/// "the resident could not cancel quickly enough" — they have five seconds and
/// the button is the largest thing on the sheet. It is a false cancel: a
/// knuckle, a pocket, a grab at the phone during the emergency the alert was
/// raised for. A hold cannot be produced by any of those.
class _HoldToCancelButton extends StatelessWidget {
  const _HoldToCancelButton({required this.hold});

  final AnimationController hold;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => hold.forward(),
      onTapUp: (_) => hold.reverse(),
      onTapCancel: () => hold.reverse(),
      child: Semantics(
        button: true,
        label: 'Cancel emergency alert. Press and hold for one second.',
        child: AnimatedBuilder(
          animation: hold,
          builder: (context, _) {
            // ── DARK BUTTON, WHITE LABEL, BOTH STATES ───────────────────────
            // Was slate-900 text on a near-white button, with the red fill
            // sweeping UNDER the label — so "Keep holding…", the one word
            // that matters mid-gesture, sat dark-on-red at about 3:1. A
            // slate-900 base with white text clears 17:1, and white on the
            // red fill still clears 4.8:1, so the label is legible wherever
            // the sweep has reached.
            return Container(
              height: 56, // comfortably over the 48px minimum
              decoration: BoxDecoration(
                color: AppColors.textPrimary,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  // The fill IS the progress indicator — it sweeps left to
                  // right and the cancel lands when it reaches the far edge.
                  FractionallySizedBox(
                    widthFactor: hold.value,
                    child: Container(color: AppColors.panicOxblood),
                  ),
                  Center(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(PhosphorIconsBold.handPalm,
                            size: 17, color: Colors.white),
                        const SizedBox(width: 8),
                        Text(
                          hold.value > 0 ? 'Keep holding…' : 'Hold to cancel',
                          style: sfPro(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                            letterSpacing: 0.2,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _FlatButton extends StatelessWidget {
  const _FlatButton({
    required this.label,
    required this.background,
    required this.foreground,
    required this.onTap,
  });

  final String label;
  final Color background;
  final Color foreground;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 54,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: Text(
          label,
          style: sfPro(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: foreground,
          ),
        ),
      ),
    );
  }
}

/// Depleting arc: a full ring at 5 seconds, empty at 0.
class _RingPainter extends CustomPainter {
  const _RingPainter({required this.progress});

  /// 1.0 at the start of the countdown, 0.0 when it fires.
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 8.0;
    final rect = Offset.zero & size;
    final centre = rect.center;
    final radius = (math.min(size.width, size.height) - stroke) / 2;

    // Neutral track. An 18% red track behind a red arc left the spent part
    // of the ring the same hue as the remaining part, so the time left was
    // only readable by its slightly deeper shade.
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = AppColors.borderNeutral;
    canvas.drawCircle(centre, radius, track);

    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..color = AppColors.panicOxblood;
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: radius),
      -math.pi / 2, // twelve o'clock
      2 * math.pi * progress.clamp(0.0, 1.0),
      false,
      arc,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) => old.progress != progress;
}
