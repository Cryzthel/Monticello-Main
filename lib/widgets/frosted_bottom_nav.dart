import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_theme.dart';

class FrostedNavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  const FrostedNavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
  });
}

/// iOS-quality frosted-glass bottom navigation with a prominent
/// center "Panic" button. Stays fixed at the bottom of the screen.
class FrostedBottomNav extends StatelessWidget {
  final int index;
  final ValueChanged<int> onChanged;
  final VoidCallback onPanic;
  final List<FrostedNavItem> leftItems;
  final List<FrostedNavItem> rightItems;
  final Color accent;

  const FrostedBottomNav({
    super.key,
    required this.index,
    required this.onChanged,
    required this.onPanic,
    required this.leftItems,
    required this.rightItems,
    this.accent = AppColors.primary,
  });

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).padding.bottom;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final navBg =
        isDark ? AppColors.midnightSurface.withValues(alpha: 0.9) : Colors.white.withValues(alpha: 0.9);
    final navBorder = isDark
        ? AppColors.innerStroke
        : Colors.black.withValues(alpha: 0.06);
    final inactive = isDark ? AppColors.textMutedOnDark : AppColors.textMuted;
    final active = isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;

    return SizedBox(
      height: 96 + bottomInset,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.bottomCenter,
        children: [
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: ClipRRect(
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 22, sigmaY: 22),
                child: Container(
                  height: 78 + bottomInset,
                  padding: EdgeInsets.only(bottom: bottomInset),
                  decoration: BoxDecoration(
                    color: navBg,
                    border: Border(
                      top: BorderSide(
                        color: navBorder,
                        width: 0.5,
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: _buildSide(
                          leftItems,
                          indexOffset: 0,
                          inactiveColor: inactive,
                          activeColor: active,
                        ),
                      ),
                      const SizedBox(width: 78),
                      Expanded(
                        child: _buildSide(
                          rightItems,
                          indexOffset: leftItems.length,
                          inactiveColor: inactive,
                          activeColor: active,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 24 + bottomInset,
            child: _PanicButton(accent: accent, onPressed: onPanic),
          ),
        ],
      ),
    );
  }

  Widget _buildSide(
    List<FrostedNavItem> items, {
    required int indexOffset,
    required Color inactiveColor,
    required Color activeColor,
  }) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: List.generate(items.length, (i) {
        final globalIndex = indexOffset + i;
        final selected = globalIndex == index;
        return _NavTab(
          item: items[i],
          selected: selected,
          accent: accent,
          inactiveColor: inactiveColor,
          activeColor: activeColor,
          onTap: () => onChanged(globalIndex),
        );
      }),
    );
  }
}

class _NavTab extends StatelessWidget {
  final FrostedNavItem item;
  final bool selected;
  final Color accent;
  final Color inactiveColor;
  final Color activeColor;
  final VoidCallback onTap;
  const _NavTab({
    required this.item,
    required this.selected,
    required this.accent,
    required this.inactiveColor,
    required this.activeColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? accent : inactiveColor;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        height: 78,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: Icon(
                selected ? item.activeIcon : item.icon,
                key: ValueKey(selected),
                color: color,
                size: 24,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              item.label,
              style: GoogleFonts.inter(
                fontSize: 10.5,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: color,
                letterSpacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PanicButton extends StatefulWidget {
  final Color accent;
  final VoidCallback onPressed;
  const _PanicButton({required this.accent, required this.onPressed});

  @override
  State<_PanicButton> createState() => _PanicButtonState();
}

class _PanicButtonState extends State<_PanicButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.mediumImpact();
        widget.onPressed();
      },
      onLongPress: () => HapticFeedback.heavyImpact(),
      behavior: HitTestBehavior.opaque,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, child) {
          final t = _pulse.value;
          final ringScale = 1 + 0.18 * t;
          final ringOpacity = (1 - t) * 0.35;
          return SizedBox(
            width: 76,
            height: 76,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Transform.scale(
                  scale: ringScale,
                  child: Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.panicOxblood.withValues(alpha: ringOpacity),
                    ),
                  ),
                ),
                child!,
              ],
            ),
          );
        },
        child: Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.panicOxblood,
                Color.lerp(AppColors.panicOxblood, Colors.black, 0.22)!,
              ],
            ),
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: [
              BoxShadow(
                color: AppColors.panicOxblood.withValues(alpha: 0.55),
                blurRadius: 22,
                spreadRadius: 1,
                offset: const Offset(0, 6),
              ),
              BoxShadow(
                color: AppColors.panicGlowOuter.withValues(alpha: 0.85),
                blurRadius: 40,
                spreadRadius: -10,
                offset: const Offset(0, 12),
              ),
            ],
          ),
          child: const Center(
            child: Icon(
              Icons.priority_high_rounded,
              color: Colors.white,
              size: 28,
            ),
          ),
        ),
      ),
    );
  }
}
