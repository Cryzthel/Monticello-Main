import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// Where a request the bar is tracking has got to.
enum NetworkTaskState {
  /// In flight. The bar paces itself against the expected round trip.
  running,

  /// Acknowledged by the server. The bar runs to full and reports back.
  succeeded,

  /// Failed. The bar stops where it is, turns red, and reports back.
  failed,
}

/// ─────────────────────── NETWORK PROGRESS BAR ───────────────────────
/// A progress bar for a request that cannot report progress.
///
/// ── THE SHAPE OF THE CURVE, AND WHY IT NEVER REACHES THE END ──────────────
/// Fill is `0.9·(1 − e^(−2.3t)) + 0.09·(1 − e^(−0.25t))`, where `t` is elapsed
/// time over the expected round trip — see [RequestPace]. Two exponentials
/// rather than one because they answer two different questions:
///
///   · the fast term is the prediction. At `t = 1` — the moment the request was
///     expected to land — it has carried the bar to ~83%, so a normal request
///     completes with a short confident snap rather than a jump from a third.
///   · the slow term is what happens when the prediction was wrong. Past the
///     expected time the bar keeps creeping, ~93% at twice the estimate, ~96%
///     at five times, and it never reaches 1.
///
/// That last part is the whole point. The bar cannot know the request is done,
/// so it must never draw the state that means "done". Only [state] moving to
/// [NetworkTaskState.succeeded] — a real server acknowledgement — closes the
/// remaining gap, in a fixed 240ms so the finish reads as an event rather than
/// as more of the same drift.
///
/// A stalled network therefore shows a bar visibly slowing to a crawl, which is
/// the truth. A spinner would have shown the same confident rotation at second
/// one and second thirty.
class NetworkProgressBar extends StatefulWidget {
  const NetworkProgressBar({
    super.key,
    required this.expected,
    required this.state,
    this.onSettled,
    this.color,
    this.trackColor,
    this.height = 4,
  });

  /// The round trip this bar is paced against, from [RequestPace.estimate].
  /// Read once at mount: repacing a bar mid-flight would make it jump.
  final Duration expected;

  final NetworkTaskState state;

  /// Fires once the bar has finished its closing animation — the moment a
  /// caller may take the row away. Called at most once.
  final VoidCallback? onSettled;

  final Color? color;
  final Color? trackColor;
  final double height;

  /// How long the bar takes to close the last gap once the server answers.
  static const Duration settle = Duration(milliseconds: 240);

  /// How long a failed bar stays on screen before reporting back, so the red
  /// is seen rather than merely rendered.
  static const Duration failLinger = Duration(milliseconds: 420);

  /// Fraction filled after [elapsed] against an [expected] round trip.
  ///
  /// Static and pure so the curve can be asserted directly — the shape is the
  /// contract here, not an implementation detail of the widget.
  static double paceFor(Duration elapsed, Duration expected) {
    if (elapsed <= Duration.zero) return 0;
    // A zero or negative expectation would divide by nothing. Treat it as "the
    // answer is already overdue" and start on the slow creep.
    final t = expected <= Duration.zero
        ? 4.0
        : elapsed.inMicroseconds / expected.inMicroseconds;
    return 0.9 * (1 - math.exp(-2.3 * t)) + 0.09 * (1 - math.exp(-0.25 * t));
  }

  @override
  State<NetworkProgressBar> createState() => _NetworkProgressBarState();
}

class _NetworkProgressBarState extends State<NetworkProgressBar>
    with SingleTickerProviderStateMixin {
  /// A [Ticker] rather than an [AnimationController]: the bar is a function of
  /// REAL elapsed time against a measured expectation, not of a fixed-duration
  /// animation. A controller would have to be given a duration up front, which
  /// is precisely the number nobody has.
  late final Ticker _ticker = createTicker(_tick);

  /// Rebuilds only the bar, not the card it sits on. This changes every frame.
  final ValueNotifier<double> _progress = ValueNotifier<double>(0);

  Duration _elapsed = Duration.zero;

  /// Set when the server answers: where the bar was, and when it started
  /// closing. Null while the request is still in flight.
  double? _settleFrom;
  Duration? _settleStart;

  Timer? _failTimer;
  bool _reported = false;

  @override
  void initState() {
    super.initState();
    // Started here, not in the field initialiser: `late final` is lazy, and a
    // ticker nothing reads until `dispose` is a bar that never moves.
    _ticker.start();
    // A request that had already finished when this mounted — a cache hit, or
    // a rebuild after the fact — still animates rather than appearing full.
    switch (widget.state) {
      case NetworkTaskState.succeeded:
        _settleFrom = 0;
        _settleStart = Duration.zero;
      case NetworkTaskState.failed:
        _failTimer = Timer(NetworkProgressBar.failLinger, _report);
      case NetworkTaskState.running:
        break;
    }
  }

  @override
  void didUpdateWidget(NetworkProgressBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.state == oldWidget.state) return;
    switch (widget.state) {
      case NetworkTaskState.succeeded:
        _settleFrom = _progress.value;
        _settleStart = _elapsed;
      case NetworkTaskState.failed:
        // Frozen where it stopped. Running a failed bar to full would draw the
        // one thing that did not happen.
        _ticker.stop();
        _failTimer ??= Timer(NetworkProgressBar.failLinger, _report);
      case NetworkTaskState.running:
        break;
    }
  }

  void _tick(Duration elapsed) {
    _elapsed = elapsed;
    final from = _settleFrom;
    if (from == null) {
      _progress.value = NetworkProgressBar.paceFor(elapsed, widget.expected);
      return;
    }

    final t = ((elapsed - _settleStart!).inMicroseconds /
            NetworkProgressBar.settle.inMicroseconds)
        .clamp(0.0, 1.0);
    _progress.value = lerpDouble(from, 1, Curves.easeOut.transform(t))!;
    if (t >= 1) {
      _ticker.stop();
      _report();
    }
  }

  void _report() {
    if (_reported) return;
    _reported = true;
    widget.onSettled?.call();
  }

  @override
  void dispose() {
    _failTimer?.cancel();
    _ticker.dispose();
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final failed = widget.state == NetworkTaskState.failed;
    final fill =
        failed ? AppColors.danger : (widget.color ?? AppColors.primary);

    return ClipRRect(
      borderRadius: BorderRadius.circular(widget.height),
      child: SizedBox(
        height: widget.height,
        child: ColoredBox(
          color: widget.trackColor ?? AppColors.neutralFill,
          child: ValueListenableBuilder<double>(
            valueListenable: _progress,
            builder: (context, value, _) => Align(
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: value.clamp(0.0, 1.0),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  color: fill,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
