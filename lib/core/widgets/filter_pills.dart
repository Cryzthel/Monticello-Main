import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// One choice in a [FilterPillBar].
@immutable
class FilterPillOption {
  const FilterPillOption(this.label, {this.icon});

  final String label;
  final IconData? icon;
}

/// The filter row used by the Announcements feed and Report History, so the
/// two read as one control (2026-10-29, by request): a horizontal strip of
/// capsules where the active one fills the brand green with white text
/// and the rest sit quiet on the card surface. Fill, outline, text and icon
/// colour all animate together on a change.
class FilterPillBar extends StatelessWidget {
  const FilterPillBar({
    super.key,
    required this.options,
    required this.selectedIndex,
    required this.onChanged,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  final List<FilterPillOption> options;
  final int selectedIndex;
  final ValueChanged<int> onChanged;
  final EdgeInsetsGeometry padding;

  /// The app's primary brand green (#047857, the CTA colour), not a lighter
  /// tint of it — the same green every primary button uses.
  static const Color activeFill = AppColors.primaryDark;
  static const Duration duration = Duration(milliseconds: 220);
  static const double height = 38;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: ListView.separated(
        padding: padding,
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) => _Pill(
          option: options[i],
          selected: i == selectedIndex,
          onTap: () => onChanged(i),
        ),
      ),
    );
  }
}

class _Pill extends StatefulWidget {
  const _Pill({required this.option, required this.selected, required this.onTap});

  final FilterPillOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_Pill> createState() => _PillState();
}

class _PillState extends State<_Pill> {
  // A swipe can select a pill that is scrolled out of the row; bring it in.
  @override
  void didUpdateWidget(_Pill old) {
    super.didUpdateWidget(old);
    if (widget.selected && !old.selected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        Scrollable.ensureVisible(
          context,
          alignment: 0.5,
          duration: FilterPillBar.duration,
          curve: Curves.easeOut,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final option = widget.option;
    final selected = widget.selected;
    final onTap = widget.onTap;
    final fg = selected ? Colors.white : AppColors.textSecondary;
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: FilterPillBar.duration,
          curve: Curves.easeOut,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: selected ? FilterPillBar.activeFill : AppColors.backgroundSecondary,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            // Unselected: the neutral hairline the cards use, not a green one.
            border: Border.all(color: selected ? FilterPillBar.activeFill : AppColors.borderNeutral),
          ),
          // One tween drives the icon and the label, so they change colour in
          // step with the fill instead of snapping ahead of it.
          child: TweenAnimationBuilder<Color?>(
            tween: ColorTween(end: fg),
            duration: FilterPillBar.duration,
            curve: Curves.easeOut,
            builder: (_, color, __) => Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (option.icon != null) ...[
                  Icon(option.icon, size: 13, color: color),
                  const SizedBox(width: 6),
                ],
                Text(
                  option.label,
                  style: sfPro(
                    fontSize: 12.5,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                    color: color,
                    height: 1.2,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
