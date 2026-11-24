import 'package:flutter/material.dart';

/// Drops keyboard focus when a tap lands on nothing that wants it.
///
/// Every form screen wraps its body in this, so tapping past the fields
/// closes the soft keyboard the same way on all of them.
///
/// `HitTestBehavior.translucent`, NOT `opaque`, and the difference is the
/// whole feature. Translucent puts this detector into the gesture arena
/// alongside whatever is under the finger; a deeper competitor — a field, a
/// button, a link in a sentence — is more specific and wins, so those keep
/// working untouched. Only a tap that nothing else claims reaches here.
/// Opaque would swallow the lot and leave a screen of dead controls.
///
/// `unfocus` rather than `SystemChannels.textInput.invokeMethod('TextInput.hide')`:
/// hiding the keyboard while a field still holds focus leaves the caret
/// blinking in an input the resident can no longer type into, and the next
/// tap anywhere brings the keyboard back with no warning. Dropping focus is
/// the state change; the keyboard closing is its consequence.
class DismissKeyboardOnTap extends StatelessWidget {
  const DismissKeyboardOnTap({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: dismissKeyboard,
      child: child,
    );
  }
}

/// Drops text focus, which closes the soft keyboard. See [DismissKeyboardOnTap]
/// for why this unfocuses rather than hiding the keyboard directly.
void dismissKeyboard() => FocusManager.instance.primaryFocus?.unfocus();

/// [action], preceded by [dismissKeyboard]; null stays null so a disabled
/// button stays disabled.
///
/// ── WHY THE BUTTONS DO THIS, NOT EACH SCREEN ──────────────────────────────
/// Every primary action in the app — submit, continue, save, back, close —
/// goes through one of a handful of shared buttons (PrimaryButton,
/// GhostButton, StagedSubmitButton, AuthButton, ModernBackButton,
/// ModernCloseButton). Pressing one with the keyboard up used to leave it up
/// on every screen that had not remembered its own `unfocus()`, so the
/// keyboard sat over the toast, the error, or the sheet the action opened.
/// Doing it once in those widgets makes it impossible to forget.
VoidCallback? withKeyboardDismissed(VoidCallback? action) {
  if (action == null) return null;
  return () {
    dismissKeyboard();
    action();
  };
}

/// Drops focus whenever a route is pushed or popped — screens, dialogs,
/// bottom sheets and menus alike.
///
/// The backstop for transitions no shared button started: a `showDialog`
/// from a list row, a confirmation sheet opened by a gesture. A field on the
/// route underneath must not keep the keyboard up over the one on top.
///
/// Popup menus and dropdowns are routes too, so they are skipped: closing
/// the keyboard because a resident opened a field's own suggestion menu
/// would be the opposite of helpful.
class KeyboardDismissingObserver extends NavigatorObserver {
  bool _isMenu(Route<dynamic>? route) =>
      route is PopupRoute && route is! DialogRoute && route is! ModalBottomSheetRoute;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (!_isMenu(route)) dismissKeyboard();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (!_isMenu(route)) dismissKeyboard();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    dismissKeyboard();
  }
}
