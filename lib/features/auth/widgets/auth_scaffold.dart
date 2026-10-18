import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';

/// The shell both authentication screens sit in: a flat canvas, a keyboard
/// that gets out of the way when you tap past it, and an optional fixed
/// header above the scrolling body.
///
/// Tap-past-the-fields dismissal is [DismissKeyboardOnTap], the same wrapper
/// every other form screen uses, so the keyboard behaves identically across
/// the whole app rather than only at the threshold.
class AuthScaffold extends StatelessWidget {
  const AuthScaffold({
    super.key,
    required this.child,
    this.header,
  });

  /// Fills the space under [header]. Usually an [AuthFormPane], or something
  /// that swaps between them.
  final Widget child;

  /// A fixed row above the scrolling body — the sign-up flow's back button.
  /// Outside the scroll area on purpose: a way back that scrolls off the top
  /// of a form is a way back you have to go looking for.
  final Widget? header;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      // `resizeToAvoidBottomInset` is left at its default of true, said out
      // loud because it is the thing doing the keyboard work. The Scaffold
      // shrinks by the inset, which shrinks the pane's viewport, which is
      // what turns the centred layout into a scrolled one — see AuthFormPane.
      // Flutter then scrolls the focused field into the remaining space on
      // its own. A KeyboardAvoidingView equivalent on top of that would be a
      // second system fighting the first.
      body: DismissKeyboardOnTap(
        child: SafeArea(
          child: header == null
              ? child
              : Column(
                  children: [
                    header!,
                    Expanded(child: child),
                  ],
                ),
        ),
      ),
    );
  }
}

/// A form that is CENTRED while it fits and SCROLLED when it does not.
///
/// ── WHY `Center` INSIDE A SCROLL VIEW DOES NOTHING ────────────────────────
/// This is the bug behind "the layout is crowded at the top", and it is worth
/// being precise because the code looked correct: both screens already said
/// `SingleChildScrollView(child: Center(child: …))`.
///
/// A scroll view hands its child UNBOUNDED height on the scroll axis — that is
/// what makes it scrollable. `Center` centres within the height it is given,
/// so given infinity it has nothing to centre against and collapses to its
/// child's own height. The content then sits at the top of the viewport and
/// every spare pixel piles up underneath it. On a tall phone that reads as a
/// form pinned to the ceiling.
///
/// The fix is to give the child a MINIMUM height equal to the viewport before
/// centring inside it. Then:
///
///   • content shorter than the screen → the box is exactly one viewport tall,
///     `Center` has something to work with, and the flow sits in the middle;
///   • content taller, or the keyboard open → the box grows past the viewport,
///     `Center` is a no-op, and it scrolls exactly as before.
///
/// One layout, both behaviours, no branch on screen size.
class AuthFormPane extends StatelessWidget {
  const AuthFormPane({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
    this.maxWidth = 400,
  });

  final Widget child;
  final EdgeInsets padding;

  /// Keeps the measure sane on a tablet, where a form stretched to 800pt is
  /// a row of very long input fields and a very long way for the eye to
  /// travel between a label and its answer.
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          padding: padding,
          // Flutter's own idiom for "dismiss the keyboard as the user starts
          // scrolling the form away". It complements the tap handler above
          // rather than duplicating it: one is a deliberate tap on nothing,
          // the other is the intent you show by dragging the page.
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              // The viewport MINUS the padding this scroll view already
              // applies — otherwise the box is taller than the space it sits
              // in by exactly the padding, and a form that fits perfectly
              // scrolls by 48pt for no reason.
              minHeight: constraints.maxHeight - padding.vertical,
            ),
            child: Center(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxWidth),
                child: child,
              ),
            ),
          ),
        );
      },
    );
  }
}
