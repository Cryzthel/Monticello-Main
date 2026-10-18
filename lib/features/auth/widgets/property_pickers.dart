import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';

// ── WHY THESE REPLACED THE SEARCHABLE DROPDOWNS ──────────────────────────────
//
// Phase, Block and Lot were text fields that unfolded a 160pt list INSIDE the
// registration form's scroll view. Two scrollables nested on one axis, and the
// outer one had `keyboardDismissBehavior: onDrag` — which listens to scroll
// notifications bubbling up from its descendants too. So the first drag on the
// option list counted as dragging the FORM: the field lost focus, the list
// collapsed under the finger, and nobody could scroll past the first few lots.
// Phase 3 Block 1 has 106 of them. Each field now opens a bottom sheet whose
// grid is the ONLY scrollable in it.
//
// ── ONE CONTROL FOR ALL THREE ────────────────────────────────────────────────
// Phase was a row of four pill tiles and Block / Lot were two text capsules
// below it: two shapes, two radii, two type treatments for three answers to
// the same question. They are now three identical selector cards in one
// three-column row, read left to right the way the address is said aloud.

/// A Phase, Block or Lot selector card: the name above, the choice below, and
/// a sheet of real numbers behind it.
class PropertyNumberField extends StatelessWidget {
  const PropertyNumberField({
    super.key,
    required this.label,
    required this.options,
    required this.value,
    required this.onChanged,
    required this.disabledHint,
    this.enabled = true,
    this.canvasColor = AppColors.background,
  });

  /// "Phase", "Block" or "Lot".
  final String label;

  /// Real numbers only, in order — the gaps in the site-plan schedule are
  /// simply absent, never shown as disabled tiles.
  final List<String> options;
  final String? value;
  final ValueChanged<String> onChanged;

  /// Said when the card is tapped while [options] is empty — "Choose a phase
  /// first." A tap on a control that cannot open answers with this rather
  /// than with nothing.
  final String disabledHint;
  final bool enabled;

  /// The outlined box's height: Login's [AuthTokens.controlHeight], so these
  /// and the sign-in fields are the same control. Fixed, so the three line up
  /// whatever is chosen.
  static const double cardHeight = AuthTokens.controlHeight;

  /// The whole control: the box plus the strip the floated label overhangs
  /// into, reserved in both states (as [AuthField] does).
  static const double height = cardHeight + AuthTokens.labelOverhang;

  /// Text inset inside the box; the resting label and the value share it.
  /// Login's inset, so the label floats to exactly where it does there.
  static const double _inset = AuthTokens.horizontalPadding;

  /// The colour behind the box, painted in the floated label's notch.
  final Color canvasColor;

  bool get _available => enabled && options.isNotEmpty;

  Future<void> _open(BuildContext context) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final picked = await showNumberPickerSheet(
      context: context,
      title: label,
      options: options,
      selected: value,
    );
    if (picked != null && picked != value) onChanged(picked);
  }

  void _explainUnavailable(BuildContext context) {
    HapticFeedback.lightImpact();
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 2),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm)),
        content: Text(
          disabledHint,
          style: sfPro(
              fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white),
        ),
      ));
  }

  @override
  Widget build(BuildContext context) {
    final chosen = value != null;
    // ── THE LOGIN PAGE'S FLOATING LABEL ──────────────────────────────────
    // Empty: the label rests inside the box, where a placeholder would be.
    // Chosen: it floats up onto the border in a notch of the page colour and
    // the number takes the box — the same motion, sizes and inks as
    // [AuthField], so every outlined field in the app behaves alike. Space
    // for the floated label is reserved in both states so nothing below
    // moves when it rises.
    final labelColor = chosen ? AppColors.textSecondary : AppColors.textMuted;
    return Semantics(
      button: true,
      enabled: _available,
      label: chosen ? '$label $value. Change' : 'Choose $label',
      excludeSemantics: true,
      onTap: _available ? () => _open(context) : null,
      child: SizedBox(
        height: height,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _PressableCard(
                // Waiting on the choice before it: still tappable, to say why.
                // While the form is submitting: silent.
                onTap: _available
                    ? () => _open(context)
                    : enabled
                        ? () => _explainUnavailable(context)
                        : null,
                dimmed: !_available,
                child: SizedBox(
                  height: cardHeight,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(_inset, 0, 16, 0),
                    child: Row(
                      children: [
                        Expanded(
                          child: AnimatedOpacity(
                            opacity: chosen ? 1 : 0,
                            duration: AuthTokens.transition,
                            child: Text(
                              value ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.fade,
                              softWrap: false,
                              style: sfPro(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        ),
                        Icon(
                          AppIcons.chevronDown,
                          size: 16,
                          color: _available
                              ? AppColors.textMuted
                              : AuthTokens.borderHover,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            AnimatedPositioned(
              duration: AuthTokens.transition,
              curve: Curves.easeOutCubic,
              left: chosen ? _inset - 5 : _inset,
              top: chosen
                  ? 0
                  : AuthTokens.labelOverhang +
                      (cardHeight - AuthTokens.restingLabelBox) / 2,
              child: IgnorePointer(
                child: AnimatedOpacity(
                  opacity: _available ? 1 : 0.6,
                  duration: const Duration(milliseconds: 150),
                  child: AnimatedDefaultTextStyle(
                    duration: AuthTokens.transition,
                    curve: Curves.easeOutCubic,
                    style: sfPro(
                      fontSize: chosen
                          ? AuthTokens.labelFloatedSize
                          : AuthTokens.labelRestingSize,
                      fontWeight: chosen ? FontWeight.w600 : FontWeight.w400,
                      color: labelColor,
                      height: AuthTokens.labelLineHeight,
                    ),
                    child: Container(
                      // The notch, painted only while floated — behind the
                      // resting label it would be a patch across the box.
                      color: chosen ? canvasColor : const Color(0x00000000),
                      padding: EdgeInsets.symmetric(horizontal: chosen ? 5 : 0),
                      child: Text(label),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The selector card's surface: white, hairline, `AppRadius.md`, the 0.97
/// press every other control on the flow uses.
class _PressableCard extends StatefulWidget {
  const _PressableCard({
    required this.child,
    required this.onTap,
    required this.dimmed,
  });

  final Widget child;
  final VoidCallback? onTap;
  final bool dimmed;

  @override
  State<_PressableCard> createState() => _PressableCardState();
}

class _PressableCardState extends State<_PressableCard> {
  bool _pressed = false;

  void _set(bool v) {
    if (_pressed != v) setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final active = widget.onTap != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: active ? (_) => _set(true) : null,
      onTapUp: active ? (_) => _set(false) : null,
      onTapCancel: active ? () => _set(false) : null,
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        child: AnimatedOpacity(
          opacity: widget.dimmed ? 0.6 : 1,
          duration: const Duration(milliseconds: 150),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: _pressed ? const Color(0xFFF8FAFC) : AuthTokens.fill,
              // The capsule, as on the Login page — one outlined-field shape
              // across every page that has one.
              borderRadius: BorderRadius.circular(AuthTokens.radius),
              border: Border.all(color: AuthTokens.border),
            ),
            child: widget.child,
          ),
        ),
      ),
    );
  }
}

/// A sheet of number tiles. Resolves to the tapped value, or null if the
/// sheet was dismissed.
Future<String?> showNumberPickerSheet({
  required BuildContext context,
  required String title,
  required List<String> options,
  String? selected,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _NumberPickerSheet(
      title: title,
      options: options,
      selected: selected,
    ),
  );
}

class _NumberPickerSheet extends StatefulWidget {
  const _NumberPickerSheet({
    required this.title,
    required this.options,
    required this.selected,
  });

  final String title;
  final List<String> options;
  final String? selected;

  @override
  State<_NumberPickerSheet> createState() => _NumberPickerSheetState();
}

class _NumberPickerSheetState extends State<_NumberPickerSheet> {
  static const int _columns = 5;
  static const double _tileHeight = 48;
  static const double _gap = 8;

  /// Past this many options the sheet offers a "jump to" field. Blocks never
  /// reach it (Phase 2 has twenty); most lot lists do.
  static const int _searchThreshold = 30;

  final _searchCtrl = TextEditingController();
  late final ScrollController _scroll;
  String _query = '';

  @override
  void initState() {
    super.initState();
    // Opens with the current choice in view rather than at Lot 1, so
    // changing Lot 87 to 88 is one tap, not a scroll.
    final index = widget.selected == null
        ? -1
        : widget.options.indexOf(widget.selected!);
    final row = index < 0 ? 0 : index ~/ _columns;
    _scroll = ScrollController(
      initialScrollOffset: row <= 1 ? 0 : (row - 1) * (_tileHeight + _gap),
    );
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<String> get _visible => _query.isEmpty
      ? widget.options
      : widget.options.where((o) => o.startsWith(_query)).toList();

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final visible = _visible;
    final showSearch = widget.options.length > _searchThreshold;

    return Padding(
      // Lifts the sheet above the keyboard while the jump field is in use.
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: media.size.height * 0.72),
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppRadius.xl),
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 10),
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AuthTokens.checkboxBorder,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      'Choose ${widget.title}',
                      style: displayFont(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      '${widget.options.length} '
                      '${widget.title.toLowerCase()}${widget.options.length == 1 ? '' : 's'}',
                      style: sfPro(fontSize: 12.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              if (showSearch)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
                  child: AuthField(
                    controller: _searchCtrl,
                    label: 'Jump to ${widget.title.toLowerCase()}',
                    hint: 'Type a number',
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    textInputAction: TextInputAction.done,
                    onChanged: (v) => setState(() => _query = v.trim()),
                    onSubmitted: (_) {
                      // An exact match is a choice; Enter on "45" picks Lot 45.
                      if (widget.options.contains(_query)) {
                        Navigator.of(context).pop(_query);
                      }
                    },
                  ),
                ),
              const SizedBox(height: 14),
              Flexible(
                child: visible.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                        child: Text(
                          'No ${widget.title.toLowerCase()} $_query here. '
                          'The site plan skips some numbers.',
                          textAlign: TextAlign.center,
                          style: sfPro(
                              fontSize: 13.5, color: AppColors.textMuted),
                        ),
                      )
                    : GridView.builder(
                        controller: _scroll,
                        padding: EdgeInsets.fromLTRB(
                            20, 0, 20, 20 + media.padding.bottom),
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: _columns,
                          mainAxisSpacing: _gap,
                          crossAxisSpacing: _gap,
                          mainAxisExtent: _tileHeight,
                        ),
                        itemCount: visible.length,
                        itemBuilder: (context, i) {
                          final option = visible[i];
                          return _ChoiceTile(
                            label: option,
                            semanticLabel: '${widget.title} $option',
                            selected: option == widget.selected,
                            height: _tileHeight,
                            radius: AppRadius.sm,
                            fontSize: 15,
                            onTap: () {
                              HapticFeedback.selectionClick();
                              Navigator.of(context).pop(option);
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One pressable choice: a phase in the row, a number in the sheet.
class _ChoiceTile extends StatefulWidget {
  const _ChoiceTile({
    required this.label,
    required this.semanticLabel,
    required this.selected,
    required this.onTap,
    required this.height,
    required this.radius,
    required this.fontSize,
  });

  final String label;
  final String semanticLabel;
  final bool selected;
  final VoidCallback onTap;
  final double height;
  final double radius;
  final double fontSize;

  @override
  State<_ChoiceTile> createState() => _ChoiceTileState();
}

class _ChoiceTileState extends State<_ChoiceTile> {
  bool _pressed = false;

  void _setPressed(bool v) {
    if (_pressed != v) setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final selected = widget.selected;
    return Semantics(
      button: true,
      inMutuallyExclusiveGroup: true,
      checked: selected,
      label: widget.semanticLabel,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _setPressed(true),
        onTapUp: (_) => _setPressed(false),
        onTapCancel: () => _setPressed(false),
        onTap: widget.onTap,
        child: AnimatedScale(
          scale: _pressed ? 0.96 : 1,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            curve: Curves.easeOut,
            height: widget.height,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              // Selected is a FILL, not just an outline: in a grid of fifty
              // white tiles the chosen one has to be findable at a glance.
              color: selected
                  ? AuthTokens.brand
                  : _pressed
                      ? const Color(0xFFF1F5F9)
                      : AuthTokens.fill,
              borderRadius: BorderRadius.circular(widget.radius),
            ),
            foregroundDecoration: BoxDecoration(
              borderRadius: BorderRadius.circular(widget.radius),
              border: Border.all(
                color: selected ? AuthTokens.brand : AuthTokens.border,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (selected) ...[
                  const Icon(PhosphorIconsBold.check,
                      size: 13, color: AuthTokens.onBrand),
                  const SizedBox(width: 4),
                ],
                Flexible(
                  child: Text(
                    widget.label,
                    maxLines: 1,
                    overflow: TextOverflow.fade,
                    softWrap: false,
                    style: sfPro(
                      fontSize: widget.fontSize,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                      color: selected
                          ? AuthTokens.onBrand
                          : AppColors.textPrimary,
                    ),
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
