import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// How many digits a password-reset code has. Four, by the estate's decision
/// (2026-10-16) — see the note on OTP_LENGTH in functions/index.js for what
/// that trades away.
///
/// ONE definition, and the client half of a pair. `functions/index.js` holds
/// the other as `OTP_LENGTH`, and the two must agree: the callable rejects a
/// code of the wrong length before it ever reaches the hash comparison, so a
/// mismatch is not a subtle bug — it is every reset in the estate failing at
/// the same step with "Email and a 4-digit code are required."
const int kOtpLength = 4;

/// The boxes a reset code is typed into, one per digit.
///
/// ── ONE REAL FIELD, SIX DRAWN BOXES ──────────────────────────────────────
///
/// The obvious build is six `TextField`s with `maxLength: 1` and focus hopping
/// between them on change. That is what this replaced, and it loses on every
/// interaction that is not typing one digit at a time:
///
///   • PASTE. A code arrives by email, so pasting is the common case, not the
///     exotic one. Pasting "418302" into a `maxLength: 1` field yields "4" and
///     silently discards the rest.
///   • BACKSPACE. Deleting from an already-empty box emits no change event on
///     most soft keyboards, so the caret sticks and the resident cannot get
///     back to fix the digit they mistyped.
///   • AUTOFILL. iOS and Android will offer a one-time code from the
///     notification shade straight into a field that asks for it — but they
///     fill ONE field, so six fields get the first character and nothing else.
///
/// A single hidden field holding the whole string gets all three for free from
/// the platform, because it is what the platform expects an OTP field to be.
/// The boxes underneath are decoration driven by that field's value, which
/// also means they cannot disagree with it.
class OtpPinInput extends StatefulWidget {
  const OtpPinInput({
    super.key,
    required this.controller,
    this.focusNode,
    this.length = kOtpLength,
    this.enabled = true,
    this.hasError = false,
    this.autofocus = true,
    this.onChanged,
    this.onCompleted,
  });

  final TextEditingController controller;
  final FocusNode? focusNode;
  final int length;

  /// False while a verification is in flight. The digits stay readable — they
  /// are what the resident is waiting on an answer about — but nothing can be
  /// changed underneath the request that was sent.
  final bool enabled;

  /// Paints the boxes as rejected. Driven by the caller, because only the
  /// caller knows whether the server said no.
  final bool hasError;

  final bool autofocus;
  final ValueChanged<String>? onChanged;

  /// Fires once, on the transition to a full code. This is what makes the
  /// screen submit itself: a resident who has typed every digit has finished,
  /// and asking them to then find a button is asking for a step that carries
  /// no information.
  final ValueChanged<String>? onCompleted;

  @override
  State<OtpPinInput> createState() => _OtpPinInputState();
}

class _OtpPinInputState extends State<OtpPinInput> {
  late final FocusNode _focus = widget.focusNode ?? FocusNode();
  bool _ownsFocus = false;
  bool _reportedComplete = false;

  @override
  void initState() {
    super.initState();
    _ownsFocus = widget.focusNode == null;
    widget.controller.addListener(_onTextChanged);
    _focus.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    _focus.removeListener(_onFocusChanged);
    if (_ownsFocus) _focus.dispose();
    super.dispose();
  }

  void _onFocusChanged() => setState(() {});

  void _onTextChanged() {
    final value = widget.controller.text;
    widget.onChanged?.call(value);
    if (value.length == widget.length) {
      // Guarded so a rebuild, a re-focus or a stray listener cannot submit the
      // same code twice — the callable counts attempts, and a double submit
      // burns two of five before the resident has done anything wrong.
      if (!_reportedComplete) {
        _reportedComplete = true;
        widget.onCompleted?.call(value);
      }
    } else {
      _reportedComplete = false;
    }
    setState(() {});
  }

  /// Where the next digit lands. Clamped, so a full code keeps the highlight
  /// on the last box rather than on a box that does not exist.
  int get _activeIndex =>
      widget.controller.text.length.clamp(0, widget.length - 1);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      // Tapping any box focuses the one field behind all of them. Without this
      // the boxes look like inputs and behave like a picture.
      behavior: HitTestBehavior.opaque,
      onTap: widget.enabled ? () => _focus.requestFocus() : null,
      child: Stack(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < widget.length; i++) _box(i),
            ],
          ),
          // The real field, invisible and stretched across the boxes so the
          // platform's own paste toolbar appears where a resident long-presses
          // and the selection it acts on is the whole code.
          Positioned.fill(
            child: Opacity(
              opacity: 0,
              child: TextField(
                controller: widget.controller,
                focusNode: _focus,
                enabled: widget.enabled,
                autofocus: widget.autofocus,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                // The hint iOS and Android read to offer a code from the
                // notification shade. It is the entire reason this is one
                // field: the platform fills one field, not one per box.
                autofillHints: const [AutofillHints.oneTimeCode],
                enableInteractiveSelection: true,
                showCursor: false,
                style: const TextStyle(color: Colors.transparent, height: 1),
                cursorColor: Colors.transparent,
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  counterText: '',
                  contentPadding: EdgeInsets.zero,
                ),
                inputFormatters: [
                  // Strips everything a paste might carry with it — spaces,
                  // dashes, the "Your code is" a resident selected too much
                  // of. What is left is digits, and only as many as fit.
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(widget.length),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _box(int index) {
    final text = widget.controller.text;
    final filled = index < text.length;
    final isActive = _focus.hasFocus && index == _activeIndex && widget.enabled;

    final Color border = widget.hasError
        ? AppColors.danger
        : isActive
            ? AppColors.primary
            : filled
                ? AppColors.primary.withValues(alpha: 0.45)
                : AppColors.innerStroke;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      // Sized for four. Six 48pt boxes filled the row; four at that size sat
      // in the middle of it like a code that had not finished loading. Wider
      // boxes with a wider gap make the code the width of the form again, and
      // each one a bigger target for the tap that focuses the field.
      width: 60,
      height: 64,
      margin: EdgeInsets.only(left: index == 0 ? 0 : 12),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: widget.hasError
            ? AppColors.danger.withValues(alpha: 0.05)
            : AppColors.backgroundSecondary,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: border, width: isActive ? 2 : 1.5),
      ),
      child: filled
          ? Text(
              text[index],
              style: sfPro(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: widget.hasError
                    ? AppColors.danger
                    : AppColors.textPrimary,
              ),
            )
          : isActive
              // A caret in the box the next digit lands in. Identical
              // empty boxes give a resident no way to tell where they are.
              ? const _BlinkingCaret()
              : const SizedBox.shrink(),
    );
  }
}

class _BlinkingCaret extends StatefulWidget {
  const _BlinkingCaret();

  @override
  State<_BlinkingCaret> createState() => _BlinkingCaretState();
}

class _BlinkingCaretState extends State<_BlinkingCaret>
    with SingleTickerProviderStateMixin {
  late final AnimationController _blink = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 550),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _blink.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _blink,
      child: Container(
        width: 2,
        height: 26,
        decoration: BoxDecoration(
          color: AppColors.primary,
          borderRadius: BorderRadius.circular(1),
        ),
      ),
    );
  }
}
