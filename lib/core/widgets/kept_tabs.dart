import 'package:flutter/material.dart';

/// The shell's tabs, kept alive across switches.
///
/// ── WHY THIS REPLACED THE AnimatedSwitcher ────────────────────────────────
/// The shell used to put `KeyedSubtree(key: ValueKey(index), child: page)`
/// inside an AnimatedSwitcher, so every tab change DISPOSED the tab being
/// left and built the next one from nothing. Coming back to Home created a
/// new Mapbox map each time (style load, tiles, camera fit), History lost its
/// scroll position and filter, and the switch stuttered while all of that
/// happened inside the transition.
///
/// Now each tab is built the first time it is opened and then stays mounted.
/// A tab that is not showing is [Offstage] (not painted, not hit-tested, not
/// in the semantics tree) and under a disabled [TickerMode] (its animations
/// pause). The Home map can sit offstage safely because it renders through a
/// TEXTURE (`textureView: true` in HomepageMapboxCard): it is part of
/// Flutter's own layer tree, so Offstage hides it like any widget. A
/// platform-view map in hybrid composition would not be reliable here.
///
/// The tab being opened fades in and lifts 1.4% (200ms, ease-out); the tab
/// being left goes offstage at once. Fading only the incoming tab keeps one
/// tab painting at a time, and never puts the map under a cross-fade that
/// would composite two full screens for the length of the transition.
class KeptTabs extends StatefulWidget {
  const KeptTabs({super.key, required this.index, required this.children});

  final int index;
  final List<Widget> children;

  @override
  State<KeptTabs> createState() => _KeptTabsState();
}

class _KeptTabsState extends State<KeptTabs>
    with SingleTickerProviderStateMixin {
  /// Tabs that have been opened at least once. Unopened tabs are not built,
  /// so a resident who never visits Settings never pays for it.
  final Set<int> _opened = {};

  late final AnimationController _enter = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 200),
    value: 1,
  );
  late final Animation<double> _curve =
      CurvedAnimation(parent: _enter, curve: Curves.easeOut);
  late final Animation<Offset> _lift = Tween<Offset>(
    begin: const Offset(0, 0.014),
    end: Offset.zero,
  ).animate(_curve);
  static const Animation<Offset> _still = AlwaysStoppedAnimation(Offset.zero);

  @override
  void initState() {
    super.initState();
    _opened.add(widget.index);
  }

  @override
  void didUpdateWidget(KeptTabs oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.index == oldWidget.index) return;
    _opened.add(widget.index);
    if (MediaQuery.disableAnimationsOf(context)) {
      _enter.value = 1;
    } else {
      _enter.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _enter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        for (var i = 0; i < widget.children.length; i++)
          if (_opened.contains(i))
            // Keyed by tab, so a tab opened later (which changes this list's
            // length) can never be matched to another tab's state.
            KeyedSubtree(
              key: ValueKey('tab-$i'),
              child: _tab(i),
            ),
      ],
    );
  }

  Widget _tab(int i) {
    final active = i == widget.index;
    // THE SAME WRAPPERS FOR EVERY TAB, active or not. Only the animations
    // they are given change. Wrapping just the active tab in the fade would
    // change the tree's shape around the page at every switch, and Flutter
    // would remount it, which is exactly what this widget exists to stop.
    return TickerMode(
      enabled: active,
      child: Offstage(
        offstage: !active,
        child: FadeTransition(
          opacity: active ? _curve : kAlwaysCompleteAnimation,
          child: SlideTransition(
            position: active ? _lift : _still,
            child: widget.children[i],
          ),
        ),
      ),
    );
  }
}
