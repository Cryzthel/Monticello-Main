/// The one definition of a strong password on mobile.
///
/// Sign-up, Change Password and the Forgot Password reset step all read this,
/// so the three can no longer disagree. They did: the reset step checked only
/// the length, so a password registration would refuse ("aaaaaaaa") could be
/// set through the recovery flow instead.
///
/// The web consoles keep their own copy in
/// `web-portal/packages/shared/src/auth/passwordPolicy.js`. The symbol class
/// below is copied character for character from it, so both platforms accept
/// exactly the same strings. Change one, change both.
class PasswordPolicy {
  PasswordPolicy._();

  static const int minLength = 8;

  static final RegExp _number = RegExp(r'\d');
  static final RegExp _special =
      RegExp(r'[!@#$%^&*(),.?":{}|<>_\-\\/\[\]`~+=;]');

  static bool hasMinLength(String v) => v.length >= minLength;
  static bool hasNumber(String v) => _number.hasMatch(v);
  static bool hasSpecial(String v) => _special.hasMatch(v);

  /// Every rule, met. There is no partial credit: a checklist that lets you
  /// submit with an unticked row is decoration.
  static bool isStrong(String v) =>
      hasMinLength(v) && hasNumber(v) && hasSpecial(v);

  /// The checklist rows, in the order every screen shows them.
  static const List<String> labels = [
    'At least 8 characters',
    'At least one number',
    'At least one special character',
  ];

  /// Whether each row in [labels] is met, index for index.
  static List<bool> check(String v) =>
      [hasMinLength(v), hasNumber(v), hasSpecial(v)];
}
