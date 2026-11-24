/// The one email check, and the one set of words for it.
///
/// Login, Create Account and Forgot Password each had their own: two checked
/// only for an "@" ("a@" passed) and said "Enter a valid email"; the reset
/// step said the same thing with a different validator behind it. A resident
/// moving between the three saw the same mistake judged and worded three ways.
///
/// Deliberately loose past the basics. Firebase Auth is the real authority on
/// what an address is; this exists to catch typing slips — a missing "@", no
/// domain, a space — before a network round trip, with a message that says
/// what is wrong.
class EmailRule {
  EmailRule._();

  static final RegExp _shape = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

  /// Null when [value] looks like an email address; otherwise the message.
  static String? validate(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'Enter your email address.';
    if (!_shape.hasMatch(v)) {
      return 'Enter a valid email address, like name@example.com.';
    }
    return null;
  }

  /// Lower-cased and trimmed — what the reset function keys its records by.
  static String normalize(String value) => value.trim().toLowerCase();
}
