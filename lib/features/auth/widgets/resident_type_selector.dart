import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';

/// Homeowner or tenant, as two compact cards that behave as one segmented
/// control.
///
/// ── COMPACT ───────────────────────────────────────────────────────────────
/// These were ~100pt tall: an icon row, a title, then a description. Two of
/// them outweighed the three address selectors above, for a choice that is
/// one tap. Now each is a single row — the radio, the name, and a short line
/// saying what it means — about 56pt, the same visual weight as the selector
/// cards, and still well over the 44pt touch minimum.
///
/// ── STATE IS DRAWN THREE WAYS, NOT ONE ────────────────────────────────────
/// A selected card gets a brand outline, a 6% brand tint and a filled radio,
/// so it still reads for someone who cannot tell emerald from slate.
///
/// The outline is painted with `foregroundDecoration`, the same trick
/// AuthField uses: a border inside `decoration` takes part in layout, so going
/// from 1pt to 1.5pt would nudge the contents half a point every tap.
class ResidentTypeSelector extends StatelessWidget {
  const ResidentTypeSelector({
    super.key,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final bool enabled;

  /// Short enough for one line in half the form at the default text size.
  static String _description(String type) =>
      type == ResidentType.homeowner ? 'Owns the unit' : 'Rents or leases';

  @override
  Widget build(BuildContext context) {
    // IntrinsicHeight so the two stay level if one line wraps at a large text
    // size and the other does not. Two cards, so its extra pass is nothing.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final type in ResidentType.all) ...[
            if (type != ResidentType.all.first) const SizedBox(width: 10),
            Expanded(
              child: _ResidentTypeCard(
                title: ResidentType.label(type),
                description: _description(type),
                selected: value == type,
                enabled: enabled,
                onTap: () {
                  if (value == type) return;
                  HapticFeedback.selectionClick();
                  onChanged(type);
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ResidentTypeCard extends StatefulWidget {
  const _ResidentTypeCard({
    required this.title,
    required this.description,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final String title;
  final String description;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  State<_ResidentTypeCard> createState() => _ResidentTypeCardState();
}

class _ResidentTypeCardState extends State<_ResidentTypeCard> {
  bool _pressed = false;

  void _setPressed(bool v) {
    if (_pressed != v) setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final selected = widget.selected;
    const duration = Duration(milliseconds: 180);

    return Semantics(
      button: true,
      inMutuallyExclusiveGroup: true,
      checked: selected,
      enabled: widget.enabled,
      label: '${widget.title}. ${widget.description}',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: widget.enabled ? (_) => _setPressed(true) : null,
        onTapUp: widget.enabled ? (_) => _setPressed(false) : null,
        onTapCancel: widget.enabled ? () => _setPressed(false) : null,
        onTap: widget.enabled ? widget.onTap : null,
        child: AnimatedScale(
          // The same 0.97 press as the primary button and the selector cards.
          scale: _pressed ? 0.97 : 1,
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          child: AnimatedContainer(
            duration: duration,
            curve: Curves.easeOut,
            constraints: const BoxConstraints(minHeight: 56),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: selected
                  ? AuthTokens.brand.withValues(alpha: 0.06)
                  : AuthTokens.fill,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            foregroundDecoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(
                color: selected ? AuthTokens.brand : AuthTokens.border,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Row(
              children: [
                _RadioDot(selected: selected),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.title,
                        style: sfPro(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      Text(
                        widget.description,
                        style: sfPro(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                          height: 1.3,
                        ),
                      ),
                    ],
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

/// An 18pt radio, the same size as AuthCheckbox. The inner dot scales in
/// rather than appearing, so the change of state is seen happening.
class _RadioDot extends StatelessWidget {
  const _RadioDot({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected ? AuthTokens.brand : Colors.transparent,
        border: Border.all(
          color: selected ? AuthTokens.brand : AuthTokens.checkboxBorder,
        ),
      ),
      child: Center(
        child: AnimatedScale(
          scale: selected ? 1 : 0,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutBack,
          child: Container(
            width: 6,
            height: 6,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: AuthTokens.onBrand,
            ),
          ),
        ),
      ),
    );
  }
}
