import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';

/// The authentication screens' control geometry, ported from the web portals.
///
/// ── THE CAPSULE IS A SCOPED EXCEPTION, NOT A NEW HOUSE STYLE ──────────────
/// Worth stating up front, because it looks like a design-system change and is
/// not one. Rule 4 of the portals' design system says text inputs stay
/// rectangular on purpose — "a stadium-shaped field is the one capsule that
/// reads as consumer rather than console" — and every field inside either
/// dashboard is `rounded-lg`. The pill exists in exactly one place over there:
/// `packages/shared/src/auth/FloatingField.jsx`, on the sign-in screens, which
/// are "the threshold rather than the console: two fields, no data, nothing to
/// scan". That component is deliberately not exported for general use.
///
/// These tokens are the mobile port of that same exception, and they are
/// scoped the same way: Login and Sign-Up only. Reaching for [AuthField] on a
/// screen with data on it is the mistake the rule exists to prevent — use the
/// app's normal `InputDecoration` there.
///
/// ── WHY #047857 AND NOT AppColors.primary ─────────────────────────────────
/// The portals' `--color-brand-500` and `--color-brand-cta` are BOTH #047857
/// on the sign-in screens, and the token file is explicit about why: the
/// brief's `bg-emerald-600` (#059669) puts a white label at about 3.8:1, under
/// the 4.5:1 normal text owes its background, and "a sign-in button is the one
/// control on the screen that must be legible to everyone". #047857 measures
/// 5.6:1.
///
/// Mobile's `AppColors.primary` is #16A34A and white on it is 3.3:1 — the same
/// failure. So the auth screens take the deeper green, exactly as the portals
/// do, and exactly as the splash emblem already does. One #047857 across the
/// threshold: the mark, the focused field, the primary action.
class AuthTokens {
  AuthTokens._();

  /// `rounded-full`. Resolved against a ~48px control, so any value past half
  /// the height is identical; [AppRadius.pill] keeps it one named thing.
  static const double radius = AppRadius.pill;

  /// `h-12`. The portal's auth field and its CTA are the same height, which is
  /// most of what makes the stack read as one system.
  static const double controlHeight = 48;

  /// `px-6` — the inset to the text, and the inset the error message below
  /// the field is indented to so it reads as belonging to the control.
  static const double horizontalPadding = 24;

  /// `bg-field` — #FFFFFF. Not `AppColors.backgroundSecondary`: a field
  /// painted the card's own value is a field you can only find by its border.
  static const Color fill = Color(0xFFFFFFFF);

  /// `border-slate-200/80`.
  ///
  /// Slate, not `AppColors.innerStroke` — that token is emerald-100 at 80%, a
  /// green hairline, which is right for the app's glass surfaces and wrong for
  /// a control that is supposed to look like the website's.
  static const Color border = Color(0xCCE2E8F0);

  /// `hover:border-slate-300`, reused here for the pressed/hover affordance.
  static const Color borderHover = Color(0xFFCBD5E1);

  /// `border-gray-300` — the unchecked tick box's outline.
  ///
  /// Its own token rather than [border]: the field hairline is slate-200 at
  /// 80% over white, which is lighter still, and a tick box drawn that faint
  /// reads as disabled. #D1D5DB is the one step between them.
  static const Color checkboxBorder = Color(0xFFD1D5DB);

  /// `--color-brand-500` / `--color-brand-cta`, light theme.
  static const Color brand = Color(0xFF047857);

  /// `--color-brand-cta-hover`.
  static const Color brandPressed = Color(0xFF065F46);

  /// `text-brand-cta-fg`.
  static const Color onBrand = Color(0xFFFFFFFF);

  /// The focused field's border — slate-500.
  ///
  /// ── THE FOCUS INDICATOR IS NEUTRAL, DELIBERATELY ───────────────────────
  /// This diverges from the portals, which focus a field in brand green, and
  /// the divergence is the point: on a form of four to six capsules a
  /// saturated outline is the loudest thing on screen every time someone
  /// touches a field, and the colour carries no information the caret's
  /// position does not already carry.
  ///
  /// Green is now reserved for what you can ACT on — the links and the
  /// primary button — and for the mark. Focus is a state, so it is drawn in
  /// ink: the border darkens from a hairline you barely notice to a definite
  /// slate. A useful side effect is that red becomes the only coloured
  /// border left, which makes an error the one thing on the form that
  /// changes hue.
  ///
  /// ── IT STILL CLEARS WCAG 2.2 FOCUS APPEARANCE ──────────────────────────
  /// Measured rather than assumed, and asserted in the tests:
  ///
  ///   slate-500 vs the resting border    3.98:1  (state contrast, needs 3:1)
  ///   slate-500 vs the field's fill      4.76:1
  ///   perimeter: 1.5pt border + 2pt ring 3.5pt   (needs 2px)
  ///
  /// ── THE STROKE IS 1pt, SO THE COLOUR DOES THE WORK ────────────────────
  /// slate-700, darkened from the slate-500 this was when the focused border
  /// was 2pt. The two changes are one decision: a 1pt indicator has half the
  /// area of a 2pt one, so it has to earn back in contrast what it gave up
  /// in width.
  ///
  ///   slate-500 at 2pt   3.98:1 state contrast
  ///   slate-700 at 1pt   8.63:1 state contrast
  ///
  /// ── WHAT 1pt COSTS, STATED PLAINLY ────────────────────────────────────
  /// WCAG 2.2 **Focus Appearance** (AAA) wants a perimeter of at least 2px.
  /// A 1pt border does not meet it, and no amount of contrast substitutes
  /// for area. This is the brief's call and it is a real trade.
  ///
  /// What still holds is the AA bar: **Focus Visible** needs a visible
  /// indicator, not a thick one, and an 8.63:1 state change is unmistakable.
  /// The named failure — "remove focus outline without replacement" — is not
  /// what happens here; the outline stays and gets darker.
  static const Color focusBorder = Color(0xFF334155);

  // `focusRing` and `errorRing` lived here and are gone with the ring they
  // coloured. The focus indicator is now the border's own width — see the
  // note on `foregroundDecoration` in AuthField.

  /// `duration-200 ease-in-out` on the border.
  static const Duration transition = Duration(milliseconds: 200);

  /// The label's resting size, inside the capsule, where it is the
  /// placeholder.
  static const double labelRestingSize = 14;

  /// Its floated size, sitting on the border.
  static const double labelFloatedSize = 11.5;

  /// Line-height multiplier, shared by both label states so their box heights
  /// are predictable rather than whatever the font happens to report.
  static const double labelLineHeight = 1.2;

  static const double floatedLabelBox = labelFloatedSize * labelLineHeight;
  static const double restingLabelBox = labelRestingSize * labelLineHeight;

  /// Room reserved ABOVE the capsule for the floated label.
  ///
  /// Exactly half the floated label's box, so that drawing it at the top of
  /// the reserved strip puts its centre line precisely on the capsule's top
  /// border. It straddles the outline rather than clearing it — which is the
  /// difference between a label cut INTO the border and a caption hovering
  /// above a box, and at a glance it is the only thing that distinguishes
  /// this from the static label it replaced.
  static const double labelOverhang = floatedLabelBox / 2;
}

/// The auth screens' tick box, painted rather than borrowed.
///
/// Material's [Checkbox] cannot be drawn smaller than its 48pt minimum tap
/// target without its own padding pushing the glyph off centre — which is
/// exactly what squeezing one into a 22x22 box did on both of these screens,
/// and why the sign-up row's box sat visibly left of and below the sentence it
/// belonged to.
///
/// So the box is only a picture; the ROW around it is the tap target, which is
/// where a 44pt target belongs anyway. Both auth screens use this one, because
/// two hand-rolled checkboxes a screen apart is how a sign-in page ends up with
/// a pale emerald square and a registration page with a slate one.
///
/// ── 18pt, DOWN FROM 20, AND 22 BEFORE THAT ────────────────────────────────
/// Sized against the 13pt label beside it rather than against the touch
/// target it is not. The cap height of 13pt Nunito Sans is about 9pt, and a
/// box reads as bulky once it runs much past twice that — 18pt sits on the
/// line where the square and the sentence look like one row rather than a
/// control with a caption next to it.
///
/// The 44pt / 48dp touch minimum is untouched by this: it governs the
/// TARGET, and the target is the whole row. Shrinking the picture does not
/// shrink the hit area.
class AuthCheckbox extends StatelessWidget {
  const AuthCheckbox({super.key, required this.checked});

  final bool checked;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      curve: Curves.easeOut,
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        color: checked ? AuthTokens.brand : Colors.transparent,
        // 6 — `rounded-md`. Both auth screens have rendered the SAME
        // widget since the sign-in screen gave up its Material Checkbox, so
        // there has been no radius to harmonise between them for a while;
        // this is the brief's preferred value applied to the one box, not a
        // reconciliation of two.
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          // ── ONE APPEARANCE, NO CONDITIONS ─────────────────────────
          // There was an `enabled` flag here, and it is why the two boxes
          // did not match despite being the same widget. Sign-up passed
          // `enabled: hasRead`, so until the policies were opened its
          // unchecked border was the pale slate-200 hairline, while the
          // login box — which has no gate and so defaulted to enabled —
          // drew the darker textMuted. Side by side the Remember-me box
          // looked harsher, which is exactly what was reported, and I twice
          // called them identical because they share a class.
          //
          // The dimming is gone rather than copied across. The sign-up
          // gate is already stated in words under the sentence ("Open
          // either one to continue"), and a control that communicates by
          // being slightly paler communicates to nobody.
          // gray-300 at 1pt. It was `AppColors.textMuted` at 1.5 — a slate
          // dark enough that an UNCHECKED box was the heaviest stroke in its
          // row, competing with the sentence it belongs to. An empty tick
          // box should be a quiet outline waiting to be filled, and the
          // filled state is where the weight belongs.
          color: checked ? AuthTokens.brand : AuthTokens.checkboxBorder,
          width: 1,
        ),
      ),
      child: AnimatedScale(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOutBack,
        scale: checked ? 1 : 0.4,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 120),
          opacity: checked ? 1 : 0,
          child: const Icon(
            PhosphorIconsBold.check,
            size: 12,
            color: AuthTokens.onBrand,
          ),
        ),
      ),
    );
  }
}

/// A capsule text field: label, hint, optional trailing control, and a
/// validation message rendered BELOW the capsule rather than inside it.
///
/// ── NO LEADING GLYPH ──────────────────────────────────────────────────────
/// Every field used to open with an icon — an envelope for email, a padlock
/// for each password. The floating label already names the field, so the
/// glyph said the same thing a second time and cost 32pt of every line's
/// width doing it. Removed from the component rather than from each caller,
/// so no screen can bring one back by accident. Trailing controls (the
/// reveal eye, a dropdown chevron) stay: those DO something.
///
/// ── WHY NOT JUST AN InputDecoration ───────────────────────────────────────
/// `OutlineInputBorder` can give the pill and the colour change, and the two
/// screens this replaces did exactly that. What it cannot give is the portal's
/// focus treatment, which is deliberately two-part: the border moves AND a
/// ring appears. Material has no ring; the only way to draw one is a
/// `BoxShadow` with zero blur on the decoration of a box that wraps the field
/// — and the moment the error message is inside that box, the ring wraps the
/// message too and paints a pill around a paragraph.
///
/// So the capsule is a [Container] this widget owns, the [TextField] inside it
/// is borderless, and the error is a sibling below. That also fixes something
/// the old fields got wrong independently: `InputDecoration.errorText` grows
/// the field's own height when it appears, so every control below a failing
/// field jumped down by 20px mid-validation.
///
/// ── THE FLOATING LABEL ────────────────────────────────────────────────────
/// At rest the field shows ONE piece of text: the label, sitting where a
/// placeholder would. On focus — or as soon as there is a value — it shrinks
/// and rises onto the top border, and the real placeholder fades in beneath
/// it. That is `FloatingField.jsx`'s behaviour, and the reason it is worth
/// the machinery is that it keeps the label visible after the field is
/// filled, which a plain placeholder does not: a form of five filled capsules
/// with no labels is unreadable the moment you look away and back.
///
/// TWO details carry it, and both are easy to miss:
///
///   • THE LABEL PAINTS THE CANVAS BEHIND ITSELF. It sits ON the border, so
///     without a background the outline runs straight through the text. The
///     colour must be the surface the field is ON, not the field's own fill —
///     pass [canvasColor] when a caller puts a field on anything but the
///     default background. The portal's copy of this carries the same warning.
///
///   • THE FIELD RESERVES THE ROOM. The floated label overhangs the capsule's
///     top edge, so the widget is taller than the capsule by
///     [AuthTokens.labelOverhang]. Reserving it unconditionally — rather than
///     only while floated — is what stops every control below a field
///     jumping down the first time it is focused.
///
/// ── VALIDATION ────────────────────────────────────────────────────────────
/// Wrapped in a [FormField] so `Form.validate()` still drives it, but the
/// validator is handed the CONTROLLER'S text rather than the FormField's
/// value. Those differ whenever a controller is filled programmatically — the
/// remembered email on the login screen is exactly that case — and a validator
/// reading a stale empty value rejects a field the user can plainly see is
/// filled.
class AuthField extends StatefulWidget {
  const AuthField({
    super.key,
    required this.controller,
    required this.hint,
    this.label,
    this.canvasColor = AppColors.background,
    this.validator,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.obscureText = false,
    this.autocorrect = true,
    this.enabled = true,
    this.autofillHints,
    this.inputFormatters,
    this.trailing,
    this.onChanged,
    this.onSubmitted,
    this.focusNode,
    this.readOnly = false,
    this.onTap,
  });

  final TextEditingController controller;
  final String hint;

  /// The field's name — "Email", "Password".
  ///
  /// Doubles as the resting placeholder: at rest this is the only text in the
  /// capsule, and [hint] does not appear until the label has floated out of
  /// its way. Omit it and the field is a plain capsule showing [hint], which
  /// is right for a search box and wrong for a form.
  final String? label;

  /// The surface this field is drawn ON, which the floated label paints
  /// behind itself to cut the border it sits on. Defaults to the app
  /// background; pass the real colour if a caller puts a field on a card.
  final Color canvasColor;

  final String? Function(String value)? validator;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final bool obscureText;
  final bool autocorrect;
  final bool enabled;
  final Iterable<String>? autofillHints;
  final List<TextInputFormatter>? inputFormatters;

  /// A control at the right edge — a reveal toggle, a chevron.
  final Widget? trailing;

  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final FocusNode? focusNode;
  final bool readOnly;
  final VoidCallback? onTap;

  @override
  State<AuthField> createState() => _AuthFieldState();
}

class _AuthFieldState extends State<AuthField> {
  FocusNode? _ownedNode;
  late FocusNode _node;
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _node = widget.focusNode ?? (_ownedNode = FocusNode());
    _node.addListener(_onFocusChange);
  }

  @override
  void didUpdateWidget(AuthField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.focusNode != oldWidget.focusNode) {
      _node.removeListener(_onFocusChange);
      _ownedNode?.dispose();
      _ownedNode = null;
      _node = widget.focusNode ?? (_ownedNode = FocusNode());
      _node.addListener(_onFocusChange);
    }
  }

  void _onFocusChange() {
    if (_focused == _node.hasFocus) return;
    setState(() => _focused = _node.hasFocus);
  }

  @override
  void dispose() {
    _node.removeListener(_onFocusChange);
    _ownedNode?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FormField<String>(
      // Re-validates as the resident types, but only after they have typed
      // once — so the form does not open covered in errors for fields nobody
      // has touched yet.
      autovalidateMode: AutovalidateMode.onUserInteraction,
      validator: (_) => widget.validator?.call(widget.controller.text),
      builder: (state) {
        final hasError = state.hasError;
        final borderColor = hasError
            ? AppColors.danger
            : _focused
                ? AuthTokens.focusBorder
                : AuthTokens.border;

        // ── THE HEIGHT IS PINNED, AND SCALES ONLY FOR ACCESSIBILITY ────
        // Letting the text's own line box drive the height looks like the
        // flexible choice and is not: line height varies by a few points
        // between the webfont and each platform's fallback, so the capsule
        // came out 48pt on one device and 53pt on another, while the button
        // beneath it stayed 48pt on both. A form whose controls agree on
        // their height only when a webfont has finished downloading is not a
        // system.
        //
        // So the control is `h-12` exactly, and the ONE thing that moves it
        // is the resident's own text-size setting — where growing the box is
        // correct and clipping the text would not be.
        final textScale = MediaQuery.textScalerOf(context).scale(15) / 15;
        final height =
            AuthTokens.controlHeight * (textScale > 1 ? textScale : 1);

        // Floated once there is anything to protect: focus, a value, or an
        // error worth naming the field for. `controller.text` rather than the
        // FormField's value, for the same reason the validator reads it —
        // a programmatically filled field is a filled field.
        final floated = widget.label == null ||
            _focused ||
            widget.controller.text.isNotEmpty;

        final capsule = AnimatedContainer(
          duration: AuthTokens.transition,
          curve: Curves.easeInOut,
          height: height,
          padding: const EdgeInsets.symmetric(
            horizontal: AuthTokens.horizontalPadding,
          ),
          decoration: BoxDecoration(
            color: widget.enabled
                ? AuthTokens.fill
                : AuthTokens.fill.withValues(alpha: 0.6),
            borderRadius: BorderRadius.circular(AuthTokens.radius),
          ),
          // ── THE FOCUS RING IS GONE; THE INDICATOR IS NOT ──────────────
          // There was a `ring-2` here: a zero-blur BoxShadow sitting outside
          // the border, ported from the portals. It was the last soft edge
          // on either screen, and on a flat white form it read as the field
          // lifting off the page — elevation, drawn with a shadow
          // primitive, on the one surface that should look printed.
          //
          // What replaces it is NOT nothing. "Remove focus outline without
          // replacement" is the named failure, so the border takes the job
          // over: 2pt on focus against 1pt at rest. Perimeter stays at 2pt,
          // state contrast stays at 3.98:1, and the field stops floating.
          //
          // ── WHY `foregroundDecoration` AND NOT `decoration` ───────────
          // A border inside `decoration` is part of LAYOUT: Flutter insets
          // the child by its width, so thickening it on focus shifts the
          // glyph and the text a point inward the instant the field is
          // tapped. That reflow is a bug this file already fixed once, by
          // pinning the width and letting the ring carry the emphasis
          // instead — and removing the ring would have brought it straight
          // back.
          //
          // `foregroundDecoration` paints OVER the child and contributes
          // nothing to layout, so the width is free to change. There is
          // 24pt of padding inside the capsule, so a 2pt stroke painted on
          // top has nothing to cover.
          foregroundDecoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AuthTokens.radius),
            // 1pt in every state. The stroke never changes width — only
            // its colour — which is also why `foregroundDecoration` is no
            // longer load-bearing for reflow, though it stays: painting the
            // outline over the child rather than inset into it is correct
            // regardless, and it keeps the option of a thicker focus open
            // without reintroducing the jump.
            border: Border.all(color: borderColor),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _node,
                  enabled: widget.enabled,
                  readOnly: widget.readOnly,
                  onTap: widget.onTap,
                  obscureText: widget.obscureText,
                  obscuringCharacter: AppInput.obscuringCharacter,
                  autocorrect: widget.autocorrect,
                  keyboardType: widget.keyboardType,
                  textInputAction: widget.textInputAction,
                  textCapitalization: widget.textCapitalization,
                  autofillHints: widget.autofillHints,
                  inputFormatters: widget.inputFormatters,
                  style: sfPro(
                    fontSize: 15,
                    fontWeight: AppInput.weight,
                    letterSpacing:
                        widget.obscureText ? AppInput.obscuredSpacing : null,
                    color: AppColors.textPrimary,
                  ),
                  // The ink the resident is typing in, not the brand. A green
                  // caret inside a slate-focused field is the last place the
                  // old treatment would have shown.
                  cursorColor: AppColors.textPrimary,
                  // Centred in the pinned box rather than padded into
                  // it, so the text sits on the capsule's axis whatever
                  // the font's line height turns out to be.
                  textAlignVertical: TextAlignVertical.center,
                  decoration: InputDecoration(
                    isCollapsed: true,
                    // ── EVERY BORDER SLOT, AND `filled`, EXPLICITLY ───
                    // `border: InputBorder.none` alone is NOT enough, and
                    // this is the bug that shipped: `InputDecoration`
                    // merges the ambient `inputDecorationTheme` into any
                    // slot the call site leaves null, and this app's
                    // theme fills `enabledBorder` and `focusedBorder`
                    // with a pill in emerald-100 plus `filled: true`.
                    //
                    // So the TextField drew its OWN pill inside the
                    // capsule this widget had already drawn — two
                    // concentric outlines per field, the inner one a
                    // green hairline that turned bright emerald on
                    // focus. It is faint enough to read as antialiasing
                    // in a 1x golden and unmistakable on a real screen.
                    //
                    // Naming all five slots is the fix. Leaving any one
                    // of them off re-opens it the next time the theme
                    // changes.
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    errorBorder: InputBorder.none,
                    focusedErrorBorder: InputBorder.none,
                    disabledBorder: InputBorder.none,
                    // The capsule paints the fill. A second one here is
                    // invisible until the two colours differ, and then
                    // it is a rounded patch inside a rounded box.
                    filled: false,
                    // The placeholder appears only once the label is
                    // out of the way. Showing both at rest stacks two
                    // greys on one line; showing neither leaves an empty
                    // capsule with no idea what goes in it.
                    hintText: floated ? widget.hint : null,
                    hintStyle: sfPro(
                      fontSize: 14,
                      fontWeight: FontWeight.w400,
                      color: AppColors.textMuted,
                      // ── 0, EXPLICITLY, AND THIS IS A BUG FIX ──────────
                      // `InputDecorator` builds the hint by merging the
                      // FIELD's style first and the decoration's `hintStyle`
                      // over the top, so any property hintStyle leaves unset
                      // is inherited from the input. The password capsules
                      // set `letterSpacing: AppInput.obscuredSpacing` (2.5)
                      // so the masking dots do not crowd each other — and
                      // that tracking leaked straight into their
                      // placeholders.
                      //
                      // The result: "Enter your password" and "At least 8
                      // characters" rendered with 2.5pt of artificial space
                      // between every letter, while the name and email
                      // placeholders — unobscured fields, no tracking — read
                      // normally. One component, two kinds of text, and the
                      // difference looked like a font bug.
                      //
                      // Explicit 0 rather than null: null inherits, which is
                      // precisely what went wrong.
                      letterSpacing: 0,
                    ),
                    contentPadding: EdgeInsets.zero,
                  ),
                  onChanged: (value) {
                    // Drives the FormField so an error clears the moment
                    // the input becomes valid, rather than on next submit.
                    state.didChange(value);
                    widget.onChanged?.call(value);
                  },
                  onSubmitted: widget.onSubmitted,
                ),
              ),
              if (widget.trailing != null) ...[
                const SizedBox(width: 4),
                widget.trailing!,
              ],
            ],
          ),
        );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              // The capsule plus the room the floated label overhangs into.
              // Reserved whether or not the label is currently up — see the
              // class doc.
              height: height + AuthTokens.labelOverhang,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: capsule,
                  ),
                  if (widget.label != null)
                    AnimatedPositioned(
                      duration: AuthTokens.transition,
                      curve: Curves.easeOutCubic,
                      // The capsule's own inset in both states. With no
                      // leading glyph the text column and the border notch
                      // start at the same x, so the label rises straight up
                      // rather than sliding sideways as it floats — and it
                      // lines up with the error message below either way.
                      left: AuthTokens.horizontalPadding,
                      // Floated: top of the reserved strip, which centres it
                      // on the border — see labelOverhang. Resting: centred
                      // in the capsule, measured from its real box rather
                      // than from a guessed glyph height.
                      top: floated
                          ? 0
                          : AuthTokens.labelOverhang +
                              (height - AuthTokens.restingLabelBox) / 2,
                      child: AnimatedDefaultTextStyle(
                        duration: AuthTokens.transition,
                        curve: Curves.easeOutCubic,
                        style: sfPro(
                          fontSize: floated
                              ? AuthTokens.labelFloatedSize
                              : AuthTokens.labelRestingSize,
                          fontWeight:
                              floated ? FontWeight.w600 : FontWeight.w400,
                          // Focused and merely-floated differ by weight and
                          // ink, not by hue — see AuthTokens.focusBorder.
                          color: hasError
                              ? AppColors.danger
                              : _focused
                                  ? AppColors.textPrimary
                                  : floated
                                      ? AppColors.textSecondary
                                      : AppColors.textMuted,
                          height: AuthTokens.labelLineHeight,
                        ),
                        child: Container(
                          // The notch. Only painted while floated — a
                          // background behind the resting label would draw a
                          // white patch across the middle of the capsule.
                          color: floated
                              ? widget.canvasColor
                              : const Color(0x00000000),
                          padding: EdgeInsets.symmetric(
                            horizontal: floated ? 5 : 0,
                          ),
                          child: Text(widget.label!),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            // Indented to the TEXT inside the capsule, not to the capsule's
            // edge, so it hangs off the control it belongs to.
            AnimatedSize(
              duration: AuthTokens.transition,
              curve: Curves.easeInOut,
              alignment: Alignment.topCenter,
              child: hasError
                  ? Padding(
                      padding: const EdgeInsets.only(
                        top: 6,
                        left: AuthTokens.horizontalPadding,
                        right: AuthTokens.horizontalPadding,
                      ),
                      child: Text(
                        state.errorText!,
                        style: sfPro(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: AppColors.danger,
                        ),
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),
          ],
        );
      },
    );
  }
}

/// The primary action on an authentication screen: a full-width capsule in the
/// deep brand green, with the portals' 0.97 press scale.
///
/// Matches `CTA` in `packages/shared/src/auth/authStyles.js` —
/// `btn h-12 w-full rounded-full bg-brand-cta text-brand-cta-fg shadow-sm
/// text-sm font-semibold disabled:opacity-60`.
class AuthButton extends StatefulWidget {
  const AuthButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.busyChild,
    this.variant = AuthButtonVariant.primary,
  });

  final String label;
  final VoidCallback? onPressed;

  /// Disables the button and swaps the label for [busyChild] — by default
  /// the app's one inline spinner, [LeafLoader], so no caller can end up
  /// with a busy button that shows nothing at all.
  final bool busy;
  final Widget? busyChild;

  final AuthButtonVariant variant;

  @override
  State<AuthButton> createState() => _AuthButtonState();
}

enum AuthButtonVariant {
  /// Filled #047857. One per screen.
  primary,

  /// A capsule outline — "Back", and anything else that is not the action the
  /// screen exists for.
  outline,
}

class _AuthButtonState extends State<AuthButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !widget.busy;
    final isPrimary = widget.variant == AuthButtonVariant.primary;

    final background = isPrimary
        ? (_pressed ? AuthTokens.brandPressed : AuthTokens.brand)
        : Colors.transparent;
    final foreground = isPrimary ? AuthTokens.onBrand : AuthTokens.brand;

    // Same rule as AuthField, for the same reason: the two controls have to
    // stay the same height at every text size, not just the default one.
    final textScale = MediaQuery.textScalerOf(context).scale(15) / 15;
    final height = AuthTokens.controlHeight * (textScale > 1 ? textScale : 1);

    return Opacity(
      // `disabled:opacity-60` — but only for DISABLED, not for BUSY. A
      // button that is working keeps its full colour and shows the spinner;
      // a button that cannot be pressed yet fades. Fading both made a
      // submission in progress look like a form that had not been filled
      // in, and put a white spinner on a 60% green it barely contrasts with.
      opacity: enabled || widget.busy ? 1 : 0.6,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _pressed = true) : null,
        onTapUp: enabled ? (_) => setState(() => _pressed = false) : null,
        onTapCancel: enabled ? () => setState(() => _pressed = false) : null,
        onTap: enabled ? withKeyboardDismissed(widget.onPressed) : null,
        child: AnimatedScale(
          // `active:scale-[0.97]`, 150ms. Small enough to read as the surface
          // taking the press rather than as the button shrinking.
          scale: _pressed ? 0.97 : 1,
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOut,
            height: height,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(AuthTokens.radius),
              border: isPrimary
                  ? null
                  : Border.all(color: AuthTokens.border, width: 1.5),
              boxShadow: isPrimary ? AppShadows.sm : null,
            ),
            child: widget.busy
                ? Semantics(
                    label: '${widget.label}, in progress',
                    child: widget.busyChild ??
                        LeafLoader(size: 20, color: foreground),
                  )
                : Text(
                    widget.label,
                    style: sfPro(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: foreground,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
