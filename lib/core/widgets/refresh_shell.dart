import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:monticello_villas_app/core/widgets/spiral_loader.dart';

/// The app's standard pull-to-refresh wrapper: a gesture-driven
/// [RefreshIndicator] (its own built-in spinner fully suppressed) paired
/// with [RefreshLoaderBar] as the sole visible loading feedback.
///
/// Refresh state ([_refreshing]) is owned locally by this widget rather
/// than hoisted onto the caller's screen-level `State` — flipping it only
/// rebuilds this small subtree, never the whole tab/screen wrapped around
/// it. This also collapses what was previously ~15 lines of duplicated
/// Column/Expanded/RefreshIndicator/state boilerplate at every pull-to-
/// refresh call site down to a single wrap.
///
/// Every screen that wraps its list in [RefreshShell] — Notices, History's
/// Active/Resolved tabs, Edit Profile — shares this exact same widget, so
/// the pop sound and haptic tap below are automatically app-wide; there is
/// no separate "History refresh" implementation to fall out of sync.
class RefreshShell extends StatefulWidget {
  final Future<void> Function() onRefresh;
  final Widget child;

  const RefreshShell({super.key, required this.onRefresh, required this.child});

  @override
  State<RefreshShell> createState() => _RefreshShellState();
}

class _RefreshShellState extends State<RefreshShell> {
  bool _refreshing = false;

  /// True only once the CURRENT gesture has pulled the list down past its
  /// top edge. Reset at the start of every scroll.
  ///
  /// ── THE "REFRESHES WHEN I SWIPE UP" BUG ───────────────────────────────
  /// The bar opens whenever [RefreshIndicator] calls back, and on a short or
  /// empty list (everything fits, so the list sits at its top AND its bottom
  /// at once) an upward swipe could still end in a refresh. The indicator's
  /// own edge test is not trusted alone any more: a refresh is honoured only
  /// if this gesture genuinely over-scrolled DOWNWARD at the top — standard
  /// native behaviour — and is otherwise answered at once without opening the
  /// bar, sounding the pop or fetching.
  bool _pulledDown = false;

  bool _onScroll(ScrollNotification n) {
    // Nested scrollables report through here too; only the list's own
    // position (depth 0) describes the pull.
    if (n.depth != 0) return false;
    if (n is ScrollStartNotification) {
      _pulledDown = false;
    } else if (n is OverscrollNotification && n.dragDetails != null) {
      // Clamping physics (Android). Overscroll < 0 is the finger pulling the
      // list down past its TOP; > 0 is the finger pushing UP.
      if (n.overscroll < 0) _pulledDown = true;
      if (n.overscroll > 0) _pulledDown = false;
    } else if (n is ScrollUpdateNotification && n.dragDetails != null) {
      // Whatever the physics, the FINGER's direction is the deciding fact:
      // the moment it moves up, this gesture is no longer a pull to refresh.
      //
      // That closes the real bug. The SDK's indicator starts a refresh on any
      // momentum scroll that arrives while it is armed — so pulling down a
      // little at the top and then flicking UP used to fire a refresh on the
      // up-flick's ballistic tail.
      final dy = n.dragDetails!.delta.dy;
      if (dy < 0) _pulledDown = false;
      // Bouncing physics (iOS): the position itself goes above the top.
      final m = n.metrics;
      if (dy > 0 && m.pixels < m.minScrollExtent) _pulledDown = true;
    }
    return false; // never swallow: the RefreshIndicator still needs these
  }
  final AudioPlayer _pop = AudioPlayer();

  /// The floor on how long the bar stays open, once opened.
  ///
  /// Exactly one turn of the loader — see [RefreshLoaderBar.spinPeriod]. A warm
  /// Firestore read can answer in well under 100ms, and the bar was closing on
  /// it: it opened and collapsed inside a fifth of a second, showing a sliver
  /// of a rotation and reading as a flicker rather than as a refresh. The
  /// resident then cannot tell whether anything was actually fetched, which is
  /// the one thing the bar exists to say.
  ///
  /// This is a FLOOR, not a fixed wait. It only ever adds time to a refresh
  /// that finished sooner than a single spin; anything slower than 1.5s is
  /// untouched and still dismisses the instant the real fetch lands, so a slow
  /// connection is still reported honestly.
  static const Duration _minVisible = RefreshLoaderBar.spinPeriod;

  Future<void> _playPop() async {
    try {
      // Play from the start even if triggered again before the previous
      // play finished (initiation + completion can fire close together on
      // a very fast refresh).
      await _pop.stop();
      await _pop.play(AssetSource('sounds/refresh_pop.wav'), volume: 0.85);
    } catch (_) {
      // The sound is a nice-to-have — a playback hiccup (e.g. no audio
      // output device) should never break the actual refresh.
    }
  }

  Future<void> _handleRefresh() async {
    if (_refreshing) return; // ignore overlapping triggers
    // Not a downward pull at the top: complete the gesture silently.
    if (!_pulledDown) return;
    _pulledDown = false;
    setState(() => _refreshing = true);
    // Started on the same line as the bar opening, and awaited at the end: what
    // is left of it is exactly the time the resident has not yet been shown.
    //
    // A timer rather than a `Stopwatch` read at the end. Same arithmetic, but a
    // timer is the only one of the two that a widget test's fake clock drives —
    // a stopwatch would keep real time while the test advances a fake one, so
    // the floor could not be asserted at all.
    final floor = Future<void>.delayed(_minVisible);
    // A light haptic tap + the pop the instant the pull is released, so the
    // refresh feels acknowledged right away.
    //
    // `unawaited`, deliberately: audio playback goes out over a platform
    // channel and can take tens of milliseconds to start. Awaiting it here
    // would hold the fetch behind the sound, which is exactly backwards.
    HapticFeedback.lightImpact();
    unawaited(_playPop());
    try {
      // Adaptive past the first spin: beyond [_minVisible] the bar dismisses
      // the instant the real fetch finishes, so it honestly reflects a slow
      // connection with no artificial delay padding it out.
      await widget.onRefresh();
      // ── THE HAPTIC REPEATS; THE SOUND DOES NOT ─────────────────────────
      //
      // A second tap confirms the fetch genuinely succeeded, and a failed
      // refresh still doesn't get one. But the POP fired on release, and a
      // warm cache answers in under a tenth of a second — so the two plays
      // landed close enough together to read as one stuttering blip rather
      // than as two events. The cue belongs to crossing the threshold, which
      // happens once.
      HapticFeedback.lightImpact();
    } finally {
      // Let the spin finish its cycle if the fetch beat it. Held in `finally`
      // so a refresh that THREW still closes on a complete rotation rather
      // than snapping shut — an error is announced by the screen, and the bar
      // vanishing mid-turn would read as a second, separate glitch.
      //
      // A fetch SLOWER than the floor has already outlasted this timer, so the
      // await costs a microtask and nothing else. The bar is never padded past
      // the work it is reporting on.
      await floor;
      if (mounted) setState(() => _refreshing = false);
    }
  }

  @override
  void dispose() {
    _pop.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        RefreshLoaderBar(active: _refreshing),
        Expanded(
          // ── THE NATIVE INDICATOR IS THE GESTURE, NOT THE PICTURE ──────────
          // [RefreshIndicator] stays for what it is genuinely good at: owning
          // the drag, the release threshold, the scroll-physics interplay and
          // the "already refreshing" guard, across two platforms' overscroll
          // behaviours. Every pixel it would draw is suppressed — transparent
          // arrow, transparent puck, no elevation — so the only thing a
          // resident sees is [RefreshLoaderBar] above the list.
          //
          // Rewriting the gesture by hand would buy one thing (a loader that
          // tracks the finger during the drag) at the cost of reimplementing
          // all of the above in the one widget four screens depend on.
          child: RefreshIndicator(
            onRefresh: _handleRefresh,
            color: Colors.transparent,
            backgroundColor: Colors.transparent,
            elevation: 0,
            // Listens BELOW the indicator, so it sees the same notifications
            // the indicator does and can veto a refresh that was not a
            // downward pull at the top — see [_pulledDown].
            child: NotificationListener<ScrollNotification>(
              onNotification: _onScroll,
              child: widget.child,
            ),
          ),
        ),
      ],
    );
  }
}

/// The strip that opens above a list while a refresh is in flight, carrying
/// the app's [SpiralLoader].
///
/// ── A BAR THAT TAKES SPACE, NOT AN OVERLAY ────────────────────────────────
/// It animates its own height from 0 to [barHeight] and pushes the list down
/// rather than floating over the first card. On a feed whose top item is a
/// record the resident may be reading, an overlay covers exactly the row they
/// pulled the screen to check.
///
/// The loader only spins while [active], and the strip is clipped, so a
/// collapsed bar is 0px tall with a stopped ticker inside it.
///
/// One turn takes [spinPeriod], and [_RefreshShellState._minVisible] holds the
/// bar open for at least that long, so the rotation the resident sees is always
/// a complete one.
class RefreshLoaderBar extends StatelessWidget {
  const RefreshLoaderBar({super.key, required this.active});

  final bool active;

  static const double barHeight = 48;
  static const double loaderSize = 30;
  static const Duration transition = Duration(milliseconds: 220);

  /// How long ONE turn of the loader takes.
  ///
  /// The loader's own default is a 900ms oscillation leg, which works out at a
  /// 2.7s turn — slow enough that a refresh finishing normally never showed a
  /// whole rotation, so the motion read as a fragment of something rather than
  /// as a cycle. At 1.5s a turn completes inside a typical fetch, and the dots'
  /// out-and-back lands at 1s, which is brisk without being frantic.
  ///
  /// [_RefreshShellState._minVisible] is this same duration, so the bar is
  /// guaranteed the time to draw exactly the cycle this names.
  static const Duration spinPeriod = Duration(milliseconds: 1500);

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: transition,
      curve: active ? Curves.easeOutCubic : Curves.easeInCubic,
      height: active ? barHeight : 0,
      clipBehavior: Clip.hardEdge,
      decoration: const BoxDecoration(),
      child: AnimatedOpacity(
        duration: transition,
        curve: active ? Curves.easeOut : Curves.easeIn,
        opacity: active ? 1 : 0,
        child: Center(
          child: SpiralLoader(
            size: loaderSize,
            spinning: active,
            // Stated as a rotation, converted once — see the helper's note on
            // why `speed` alone is the ambiguous number to hard-code here.
            speed: SpiralLoader.speedForRotation(spinPeriod),
          ),
        ),
      ),
    );
  }
}
