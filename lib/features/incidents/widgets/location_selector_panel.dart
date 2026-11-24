import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart'
    show AuthTokens;
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';
import 'package:monticello_villas_app/features/property/services/recent_locations_store.dart';

/// The metric and colour tokens every address control on the report screen
/// reads.
///
/// `bg-white border border-slate-200 rounded-lg px-3 py-2`, expressed once. The
/// report screen's description field reads these too, so the location card and
/// the field under the map cannot drift into two different ideas of what an
/// input looks like.
class AddressFieldStyle {
  AddressFieldStyle._();

  /// `rounded-lg`.
  static const double radius = 10;

  /// `px-3`.
  static const double padX = 12;

  /// `py-2`.
  static const double padY = 9;

  /// Single-line control height. 48 — the Login field's height — now that
  /// the field's text is set larger (see the legibility note on
  /// [LocationEntryCard]); 44 crowded a 15.5pt line.
  static const double height = 48;

  /// Gap between a leading glyph and its text.
  static const double iconGap = 10;

  /// The estate-wide stroke weight — see AppStroke.card.
  static const double borderWidth = 1.5;

  /// `border-slate-200` at rest.
  ///
  /// Was emerald-600 on every field of this form, which meant a resting input
  /// looked like a focused one and focus had nowhere left to go. Slate at rest
  /// frees emerald to mean "this is the field you are typing in".
  static const Color border = AppColors.borderNeutral;

  /// Login's focus treatment: the border darkens to slate, not green. Every
  /// field on the report form — this one and the description — shares it.
  static const Color borderFocused = AuthTokens.focusBorder;

  /// The typed text and the hint. One size for every field on the form, set
  /// large enough to read at arm's length.
  static const double textSize = 15.5;
  static const double hintSize = 15;

  /// The label above each box (2026-10-19: labels moved outside the field).
  /// 14 — the size the floated label was held at for legibility — set
  /// semi-bold so it reads as the question and the placeholder as the hint.
  static const double labelSize = 14;

  /// Between the label and its box.
  static const double labelGap = 8;

  /// How much room a focused field asks for when it scrolls itself into view.
  ///
  /// The report screen's footer now lifts above the keyboard, which shrinks
  /// the step's scroll viewport to the visible area — so the keyboard's
  /// height no longer belongs in this reveal (it used to be added here, when
  /// the viewport ran on underneath the keyboard). The extra 24 keeps the
  /// field's bottom edge clear of the button sitting right below it.
  static EdgeInsets scrollPaddingFor(BuildContext context) =>
      const EdgeInsets.fromLTRB(20, 20, 20, 44);

  static OutlineInputBorder outline(Color color) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: color, width: borderWidth),
      );
}

/// THE bordered text input on the report form.
///
/// The Phase / Block / Lot search field and the Incident details textarea both
/// render through this, so their height, padding, type scale, border and
/// label are identical by construction. They used to be two
/// implementations that agreed on most numbers and disagreed on the rest —
/// different text sizes, a label inside one and a heading on the other,
/// an emerald focus border on one and slate on the other.
class AddressInput extends StatelessWidget {
  const AddressInput({
    super.key,
    required this.controller,
    required this.hint,
    this.label,
    this.icon,
    this.focusNode,
    this.autofocus = false,
    this.maxLines = 1,
    this.suffix,
    this.onChanged,
    this.onTap,
    this.readOnly = false,
    this.onSubmitted,
    this.textInputAction,
  });

  final TextEditingController controller;
  final String hint;

  /// The label, drawn above the box. [hint] is the placeholder inside it,
  /// shown whenever the field is empty.
  final String? label;

  final IconData? icon;
  final FocusNode? focusNode;
  final bool autofocus;
  final int maxLines;
  final Widget? suffix;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onTap;
  final bool readOnly;

  /// The keyboard's action key. Callers that pass this get the keyboard
  /// dismissed BEFORE their handler runs — see [_submit].
  final ValueChanged<String>? onSubmitted;
  final TextInputAction? textInputAction;

  void _submit(String value) {
    FocusManager.instance.primaryFocus?.unfocus();
    onSubmitted?.call(value);
  }

  @override
  Widget build(BuildContext context) {
    final hasIcon = icon != null;
    final single = maxLines == 1;

    final field = TextField(
      controller: controller,
      scrollPadding: AddressFieldStyle.scrollPaddingFor(context),
      focusNode: focusNode,
      autofocus: autofocus,
      maxLines: maxLines,
      onChanged: onChanged,
      onTap: onTap,
      readOnly: readOnly,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted == null ? null : _submit,
      textAlignVertical:
          single ? TextAlignVertical.center : TextAlignVertical.top,
      style: sfPro(
          fontSize: AddressFieldStyle.textSize,
          color: AppColors.textPrimary,
          fontWeight: AppInput.weight),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: sfPro(
            fontSize: AddressFieldStyle.hintSize, color: AppColors.textMuted),
        filled: true,
        fillColor: AppColors.backgroundSecondary,
        isDense: true,
        prefixIcon: hasIcon
            ? Padding(
                padding: const EdgeInsets.only(
                    left: AddressFieldStyle.padX,
                    right: AddressFieldStyle.iconGap),
                child: Icon(icon, size: 18, color: AppColors.neutralIcon),
              )
            : null,
        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        suffixIcon: suffix == null
            ? null
            : Padding(
                padding: const EdgeInsets.only(
                    left: 6, right: AddressFieldStyle.padX),
                child: suffix,
              ),
        suffixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        contentPadding: EdgeInsets.only(
          left: hasIcon ? 0 : AddressFieldStyle.padX,
          right: suffix == null ? AddressFieldStyle.padX : 0,
          top: AddressFieldStyle.padY,
          bottom: AddressFieldStyle.padY,
        ),
        border: AddressFieldStyle.outline(AddressFieldStyle.border),
        enabledBorder: AddressFieldStyle.outline(AddressFieldStyle.border),
        focusedBorder:
            AddressFieldStyle.outline(AddressFieldStyle.borderFocused),
        errorBorder: AddressFieldStyle.outline(AppColors.danger),
        focusedErrorBorder: AddressFieldStyle.outline(AppColors.danger),
      ),
    );

    final box = SizedBox(
      height: single ? AddressFieldStyle.height : null,
      child: field,
    );
    if (label == null) return box;

    // ── THE LABEL SITS OUTSIDE, ABOVE THE BOX (2026-10-19, by request) ──────
    // It used to rest inside the field and float onto its border on focus.
    // That hid the placeholder until the field was tapped, and the floated
    // label was small text riding a line. Above the box it never moves, and
    // the placeholder inside is always there to say what to type.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label!,
          style: sfPro(
            fontSize: AddressFieldStyle.labelSize,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: AddressFieldStyle.labelGap),
        box,
      ],
    );
  }
}

/// "Where is the incident?" — one searchable Phase / Block / Lot field.
///
/// RESTORED (2026-10-18). For a day this was three tap-to-pick cards; the
/// user asked for the searchable field back, since typing "2 5 2" or "blk 5"
/// is faster than three sheets. The free-text street/landmark/gate box stays
/// removed. Labels, the field's text and the dropdown rows are set one to two
/// steps larger than before for legibility.
///
/// ── ONE FIELD, NOT THREE ───────────────────────────────────────────────────
/// Phase, Block and Lot were briefly three separate controls (a dropdown and
/// two number boxes). They are one field again, because they are one answer:
/// nobody knows their block but not their lot, and splitting the address into
/// three widgets meant three tap targets, three labels and three chances to
/// leave one blank. It also made the estate's real schedule unreachable — a
/// number box cannot tell you that Block 3 starts at Lot 25, it can only reject
/// you after you have guessed. One searchable field over the actual directory
/// offers the lots that exist and nothing else.
class LocationEntryCard extends StatelessWidget {
  const LocationEntryCard({
    super.key,
    required this.address,
    required this.onAddressChanged,
    this.errorText,
  });

  /// The chosen lot, or null while nothing has been picked.
  final SubdivisionAddress? address;
  final ValueChanged<SubdivisionAddress?> onAddressChanged;

  final String? errorText;

  @override
  Widget build(BuildContext context) {
    // The field draws its own label above the box, the same way Incident
    // details does directly beneath it, so the form's two inputs read as one
    // set.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LocationSearchField(
          address: address,
          onAddressChanged: onAddressChanged,
        ),
        if (errorText != null) ...[
          const SizedBox(height: 8),
          _PanelNote(
            icon: PhosphorIconsFill.warningCircle,
            tone: AppColors.danger,
            message: errorText!,
          ),
        ],
      ],
    );
  }
}

/// The unified Phase / Block / Lot field, with a Grab-style dropdown.
///
/// ── WHY A DROPDOWN AND NOT A MODAL SHEET ───────────────────────────────────
/// This used to open a full-height bottom sheet. A sheet covers the map and the
/// street field the resident has just filled in, for a list that is usually two
/// rows long — the recents. An overlay anchored to the field keeps the page
/// where it was and puts the answers directly beneath the question.
///
/// It lives in the app's [Overlay], NOT in the page's scroll view, so its own
/// scrolling can never be confused with the page's.
///
/// ── THREE STATES ───────────────────────────────────────────────────────────
///   • FIRST OPEN, nothing typed, no history → a prompt. Deliberately NOT a
///     list of all 1,444 lots, or of the four phases: a dropdown that answers
///     itself before being asked buries the one row that was wanted.
///   • OPENED AGAIN → "Recent Locations" first, which is the whole Grab trick.
///     The second report you file is mostly already entered.
///   • TYPING → live results from the estate's real schedule.
/// The search field's label, above the box.
const String kLocationFieldLabel = 'Phase, Block & Lot';

class LocationSearchField extends StatefulWidget {
  const LocationSearchField({
    super.key,
    required this.address,
    required this.onAddressChanged,
  });

  final SubdivisionAddress? address;
  final ValueChanged<SubdivisionAddress?> onAddressChanged;

  @override
  State<LocationSearchField> createState() => _LocationSearchFieldState();
}

class _LocationSearchFieldState extends State<LocationSearchField> {
  final TextEditingController _query = TextEditingController();
  final FocusNode _focus = FocusNode();
  final LayerLink _link = LayerLink();
  final OverlayPortalController _portal = OverlayPortalController();

  List<SubdivisionAddress> _results = const [];
  List<SubdivisionAddress> _recents = const [];
  bool _recentsLoaded = false;

  /// True once the resident has typed since the field was last focused.
  ///
  /// This is what separates "tapped the field again" from "is searching". On a
  /// re-tap the box still holds the address they picked last time, and treating
  /// that text as a query would show them the row they already have instead of
  /// their history.
  bool _typing = false;

  /// The address this field is currently holding. Tracked locally as well as in
  /// [widget.address] because selection has to update the text BEFORE the
  /// parent's rebuild reaches us.
  SubdivisionAddress? _committed;

  /// Measured from the field so the dropdown is exactly as wide as it.
  double _fieldWidth = 0;

  @override
  void initState() {
    super.initState();
    _committed = widget.address;
    _query.text = _committed?.label ?? '';
    _focus.addListener(_onFocusChanged);
  }

  @override
  void didUpdateWidget(LocationSearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // An address set from elsewhere (cleared by the form, say). Mirror it in,
    // but never while the resident is typing into the box.
    if (widget.address != oldWidget.address && widget.address != _committed) {
      _committed = widget.address;
      if (!_focus.hasFocus) _query.text = _committed?.label ?? '';
    }
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocusChanged);
    _focus.dispose();
    _query.dispose();
    super.dispose();
  }

  void _onFocusChanged() {
    if (_focus.hasFocus) {
      _typing = false;
      _portal.show();
      _loadRecents();
    } else {
      _portal.hide();
      // Free text that was never resolved to a lot is not an address. Put the
      // box back to whatever IS the address, so it can never show something the
      // form is not actually holding.
      _query.text = _committed?.label ?? '';
    }
    if (mounted) setState(() {});
  }

  Future<void> _loadRecents() async {
    final loaded = await RecentLocationsStore.load();
    if (!mounted) return;
    setState(() {
      _recents = loaded;
      _recentsLoaded = true;
    });
  }

  void _onQueryChanged(String value) {
    setState(() {
      _typing = true;
      _results = SubdivisionDirectory.search(value);
    });
    // Typing over a chosen address un-chooses it. The alternative is a box
    // reading "Phase 2, Bl" while the form still holds Phase 1, Block 4.
    if (_committed != null) {
      _committed = null;
      widget.onAddressChanged(null);
    }
  }

  Future<void> _select(SubdivisionAddress address) async {
    HapticFeedback.selectionClick();
    // Persisted BEFORE anything else, so the entry survives even if the report
    // is abandoned — which is exactly when a resident is most likely to come
    // back and file it again.
    await RecentLocationsStore.remember(address);
    final refreshed = await RecentLocationsStore.load();
    if (!mounted) return;

    setState(() {
      _recents = refreshed;
      _recentsLoaded = true;
      _typing = false;
      _committed = address;
      _query.text = address.label;
    });
    widget.onAddressChanged(address);
    _focus.unfocus();
  }

  /// The keyboard's search key. [AddressInput] has already dropped focus by
  /// the time this runs, which closed the dropdown and put the box back to the
  /// committed address — so the best match was captured from [_results]
  /// rather than read from the panel. A query that matches something takes
  /// its top hit, exactly as tapping the first row would; one that matches
  /// nothing leaves the form as it was.
  void _onSubmitted(String value) {
    final best = _typing && value.trim().isNotEmpty && _results.isNotEmpty
        ? _results.first
        : null;
    if (best != null) unawaited(_select(best));
  }

  void _clear() {
    _query.clear();
    setState(() {
      _typing = false;
      _results = const [];
      _committed = null;
    });
    widget.onAddressChanged(null);
  }

  Future<void> _clearRecents() async {
    await RecentLocationsStore.clear();
    if (!mounted) return;
    setState(() => _recents = const []);
  }

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _link,
      child: OverlayPortal(
        controller: _portal,
        overlayChildBuilder: _buildDropdown,
        child: LayoutBuilder(
          builder: (context, constraints) {
            _fieldWidth = constraints.maxWidth;
            return AddressInput(
              controller: _query,
              focusNode: _focus,
              label: kLocationFieldLabel,
              // Short, and it names the three things that work. The old hint
              // read "Search by Phase, Block, or Lot" and was followed, the
              // instant the field was tapped, by a panel repeating the same
              // sentence plus two more — so the first thing a resident met was
              // four lines of instructions for one text box.
              hint: 'Enter your phase, block or lot…',
              onChanged: _onQueryChanged,
              textInputAction: TextInputAction.search,
              onSubmitted: _onSubmitted,
              suffix: _buildSuffix(),
            );
          },
        ),
      ),
    );
  }

  /// The clear button and the dropdown caret, in that order.
  ///
  /// ── WHY THERE IS A CARET AT ALL ───────────────────────────────────────────
  /// This control is a combobox: it takes typing, but the common path is
  /// tapping it and picking a row. With only a magnifying glass on the left it
  /// read as a plain search box — something that does nothing until you type —
  /// and the recents panel underneath it went undiscovered because nothing on
  /// the field suggested there was anything to open.
  ///
  /// The caret flips to point up while the panel is open, so it reports the
  /// state as well as advertising the affordance, and tapping it toggles the
  /// panel rather than being inert decoration beside a field that does.
  Widget _buildSuffix() {
    final open = _focus.hasFocus;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_query.text.isNotEmpty) ...[
          GestureDetector(
            onTap: _clear,
            behavior: HitTestBehavior.opaque,
            child: const Icon(PhosphorIconsFill.xCircle,
                size: 18, color: AppColors.textMuted),
          ),
          const SizedBox(width: 8),
        ],
        GestureDetector(
          onTap: () => open ? _focus.unfocus() : _focus.requestFocus(),
          behavior: HitTestBehavior.opaque,
          child: AnimatedRotation(
            turns: open ? 0.5 : 0,
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            child: Icon(
              AppIcons.chevronDown,
              size: 16,
              color: open ? AppColors.accentPrimary : AppColors.neutralIcon,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDropdown(BuildContext context) {
    final body = _buildDropdownBody();
    // Nothing to say, so nothing is drawn — not an empty bordered box hanging
    // under the field. See [_buildDropdownBody].
    if (body == null) return const SizedBox.shrink();

    return CompositedTransformFollower(
      link: _link,
      targetAnchor: Alignment.bottomLeft,
      followerAnchor: Alignment.topLeft,
      offset: const Offset(0, 6),
      // TextFieldTapRegion, so a tap on a row does not read as a tap OUTSIDE
      // the field. Without it the field blurs, the overlay closes, and the tap
      // lands on whatever the dropdown was covering.
      child: TextFieldTapRegion(
        child: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: _fieldWidth,
            child: Material(
              color: Colors.transparent,
              child: Container(
                constraints: const BoxConstraints(maxHeight: 268),
                decoration: BoxDecoration(
                  color: AppColors.backgroundElevated,
                  borderRadius: BorderRadius.circular(AddressFieldStyle.radius),
                  border: Border.all(
                    color: AppColors.borderNeutral,
                    width: AddressFieldStyle.borderWidth,
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: AppColors.shadowMedium,
                      blurRadius: 18,
                      offset: Offset(0, 6),
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: body,
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// What the panel shows, or null when it has nothing to show.
  ///
  /// Null is a real and common state, not an edge case: it is what a resident
  /// who has never filed a report sees the moment they tap the field.
  Widget? _buildDropdownBody() {
    // ── TYPING ──────────────────────────────────────────────────────────────
    if (_typing && _query.text.trim().isNotEmpty) {
      if (_results.isEmpty) return const _NoMatchState();
      return _AddressList(
        addresses: _results,
        current: _committed,
        leading: PhosphorIconsFill.house,
        onSelect: _select,
      );
    }

    // Recents have not come back from disk yet. Nothing rather than a spinner —
    // it is a local read that takes a frame or two, and a flash of loading
    // chrome is more disruptive than the wait.
    if (!_recentsLoaded) return null;

    // ── OPENED AGAIN, WITH HISTORY ──────────────────────────────────────────
    if (_recents.isNotEmpty) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 10, 6),
            child: Row(
              children: [
                Text(
                  'Recent Locations',
                  style: sfPro(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                    letterSpacing: 0.2,
                  ),
                ),
                const Spacer(),
                _ClearHistoryButton(onTap: _clearRecents),
              ],
            ),
          ),
          Flexible(
            child: _AddressList(
              addresses: _recents,
              current: _committed,
              leading: PhosphorIconsFill.clockCounterClockwise,
              onSelect: _select,
            ),
          ),
        ],
      );
    }

    // ── FIRST OPEN, NOTHING REMEMBERED ──────────────────────────────────────
    //
    // Nothing at all. No heading, no example query, no count of the directory.
    // Tapping the field leaves a clean box to type into, and the panel appears
    // when it has an ANSWER — matches, or somewhere the resident has been
    // before. A tip is not an answer, and it was landing on top of the one
    // moment the resident had already decided what to do.
    //
    // The single exception is a phase the estate has built but whose lot
    // schedule has not been entered yet. That is not a tip — it is the reason
    // a real address will return no matches, and without it a resident
    // concludes their lot does not exist.
    if (SubdivisionDirectory.phasesAwaitingData.isEmpty) return null;
    return const _UnloadedPhasesNotice();
  }
}

/// Wipes the remembered searches.
///
/// A filled pill with a glyph rather than the bare word "Clear" it replaces.
/// That was an 11px text link in the header row of a panel whose every other
/// row is also tappable — it read as a label, and the one control in the
/// dropdown that is not a search result looked exactly like the section title
/// beside it.
///
/// Neutral rather than red, deliberately. This panel opens every time the field
/// is focused, so a danger-toned button would be the loudest thing on a routine
/// surface — and what it destroys is a local typing shortcut that rebuilds
/// itself on the next selection. Prominence here is the button SHAPE, not the
/// colour.
class _ClearHistoryButton extends StatelessWidget {
  const _ClearHistoryButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: AppColors.neutralFill,
          borderRadius: BorderRadius.circular(AppRadius.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(PhosphorIconsFill.trashSimple,
                size: 12, color: AppColors.textSecondary),
            const SizedBox(width: 5),
            Text(
              'Clear History',
              style: sfPro(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// THE standardized address block: `Phase 1, Block 4, Lot 12` in bold slate,
/// `Monticello Villas (MV1)` in emerald under it.
class _AddressLines extends StatelessWidget {
  const _AddressLines({required this.address});

  final SubdivisionAddress address;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          address.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: sfPro(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
            height: 1.2,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          address.subtitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: sfPro(
            fontSize: 12.5,
            fontWeight: FontWeight.w500,
            color: AppColors.accentPrimary,
            height: 1.2,
          ),
        ),
      ],
    );
  }
}

class _AddressList extends StatelessWidget {
  const _AddressList({
    required this.addresses,
    required this.current,
    required this.leading,
    required this.onSelect,
  });

  final List<SubdivisionAddress> addresses;
  final SubdivisionAddress? current;
  final IconData leading;
  final ValueChanged<SubdivisionAddress> onSelect;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      // Shrink-wrapped so a two-row history makes a two-row dropdown rather
      // than a 268px box mostly full of nothing. The cap on the container is
      // what stops a long result set running off the screen.
      shrinkWrap: true,
      padding: EdgeInsets.zero,
      // MANUAL, not onDrag. This list lives in an overlay under a field the
      // resident is still typing into; onDrag closed the keyboard the moment
      // they scrolled the suggestions, which dropped focus, collapsed the
      // dropdown and threw the query away mid-search.
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
      itemCount: addresses.length,
      separatorBuilder: (_, __) => const Divider(
        height: 1,
        indent: 12,
        endIndent: 12,
        color: AppColors.borderNeutralSoft,
      ),
      itemBuilder: (context, index) {
        final address = addresses[index];
        final isCurrent = address == current;
        return InkWell(
          onTap: () => onSelect(address),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Row(
              children: [
                Icon(
                  leading,
                  size: 17,
                  color:
                      isCurrent ? AppColors.primaryDark : AppColors.neutralIcon,
                ),
                const SizedBox(width: AddressFieldStyle.iconGap),
                // The primary line is bold on EVERY row, not only the selected
                // one. Weight is the address hierarchy here; "this is the one
                // you picked" is carried by the glyph and the check.
                Expanded(child: _AddressLines(address: address)),
                if (isCurrent)
                  const Icon(PhosphorIconsFill.checkCircle,
                      size: 17, color: AppColors.accentPrimary),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// `['1','2','3','5']` → `"1, 2, 3 and 5"`. The phases are not contiguous —
/// there is no Phase 4 — so this cannot be shortened to a range.
String _readableList(List<String> items) {
  if (items.isEmpty) return '';
  if (items.length == 1) return items.single;
  return '${items.take(items.length - 1).join(', ')} and ${items.last}';
}

/// The one thing the dropdown says before anything is typed: that a phase the
/// estate has built has no lot schedule loaded yet.
///
/// ── WHAT USED TO BE HERE ──────────────────────────────────────────────────
/// A four-line prompt, later trimmed to one: `Try “Phase 2”, “Blk 4”, or just
/// “1 4 12”.` Even at one line it was a tip laid over the field at the exact
/// moment the resident had already decided what to type, and it made focusing
/// a text box produce a floating panel of instructions.
///
/// This is not that. It is a reason: without it, a resident searching a real
/// address in an unloaded phase gets no matches and concludes their lot does
/// not exist. It renders only when [SubdivisionDirectory.phasesAwaitingData] is
/// non-empty — which is never, today, with all four phases loaded — and the
/// panel does not open at all otherwise.
class _UnloadedPhasesNotice extends StatelessWidget {
  const _UnloadedPhasesNotice();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Text(
        'Phase ${_readableList(SubdivisionDirectory.phasesAwaitingData)} '
        'addresses are still being added — use the street or landmark field '
        'above for now.',
        style: sfPro(
          fontSize: 13,
          color: AppColors.textMuted,
          height: 1.4,
        ),
      ),
    );
  }
}

class _NoMatchState extends StatelessWidget {
  const _NoMatchState();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(PhosphorIconsFill.mapPinSimpleArea,
                  size: 16, color: AppColors.textMuted),
              const SizedBox(width: 8),
              Text(
                'No lot matches that',
                style: sfPro(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Check the block and lot numbers, or describe the spot in the '
            'street or landmark field above instead.',
            style: sfPro(
              fontSize: 13,
              color: AppColors.textSecondary,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _PanelNote extends StatelessWidget {
  const _PanelNote({
    required this.icon,
    required this.tone,
    required this.message,
  });

  final IconData icon;
  final Color tone;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: tone, size: 14),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: sfPro(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }
}
