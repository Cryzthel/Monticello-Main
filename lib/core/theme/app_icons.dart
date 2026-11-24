import 'package:flutter/widgets.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Every shared glyph in the app, chosen once.
///
/// ── WHY A REGISTRY AND NOT JUST "USE PHOSPHOR" ────────────────────────────
/// The app already had a single icon LIBRARY — Phosphor, vendored under
/// `third_party/`, no second family anywhere. That was never the problem. The
/// problem was that the same action was drawn differently depending on which
/// file you were in:
///
///  · "Go forward" was `PhosphorIconsFill.caretRight` at 22px in Settings, at
///    14px on the announcement card, and at 13px in the announcements panel.
///  · "Back" was `PhosphorIconsFill.caretLeft` until it moved to Bold; nothing
///    stopped the next screen reaching for Fill again.
///
/// A registry makes "one icon per action" a compile-time fact instead of a
/// convention people remember at review time.
///
/// ── ON WEIGHT: BOLD, NOT FILL ─────────────────────────────────────────────
/// Everything here is [PhosphorIconsBold] — Phosphor's stroked weight, the
/// closest match to the Lucide/Heroicons line-art the design system asks for.
///
/// This matters most for the carets. Phosphor's FILL weight does not thicken a
/// caret, it fills it: `caretRight` in Fill is a solid triangle — a play
/// button — not a chevron. Every navigation affordance in the app was drawing
/// one, which is why they read as heavy.
///
/// SCOPE NOTE, because this is deliberately partial: Fill is still used
/// elsewhere — the bottom nav's tab glyphs, incident category identity icons,
/// status badges. Those were made Fill on purpose during the Soft Modernism
/// pass and converting them is a separate decision, not a cleanup. What is
/// unified here is the set of glyphs that appear on MORE THAN ONE screen.
class AppIcons {
  AppIcons._();

  // ── Navigation ──
  /// Back. Used by `ModernBackButton`, which every screen's header routes
  /// through.
  static const IconData chevronLeft = PhosphorIconsBold.caretLeft;

  /// Forward / drill-in. The trailing glyph on a settings row, a "Read more",
  /// a "See all" — one shape for "there is more this way".
  static const IconData chevronRight = PhosphorIconsBold.caretRight;

  /// Expand / collapse. The trailing glyph on a combo field, an accordion
  /// header, a dropdown — anything that opens downward in place rather than
  /// navigating away, which is why it is not [chevronRight].
  static const IconData chevronDown = PhosphorIconsBold.caretDown;

  /// The open state of [chevronDown].
  static const IconData chevronUp = PhosphorIconsBold.caretUp;

  /// Dismiss. Used by `ModernCloseButton`.
  static const IconData close = PhosphorIconsBold.x;

  /// Confirm / selected.
  static const IconData check = PhosphorIconsBold.check;

  // ── Map actions ──
  static const IconData currentLocation = PhosphorIconsFill.crosshair;
  static const IconData toStreets = PhosphorIconsBold.mapTrifold;
  static const IconData toSatellite = PhosphorIconsBold.globeHemisphereWest;

  // ── Settings rows ──
  /// Property details. A HOUSE, not the map pin this used to be: the row opens
  /// the resident's lot, block and phase — a dwelling — and a pin says
  /// "location on a map", which is the neighbouring screen.
  static const IconData property = PhosphorIconsBold.house;

  /// Change password. `Lock` over `KeyRound`: a key is the credential itself,
  /// a lock is the thing being secured, and the row is about the account.
  static const IconData password = PhosphorIconsBold.lock;

  static const IconData darkMode = PhosphorIconsBold.moon;
  static const IconData pushNotifications = PhosphorIconsBold.bellRinging;
  static const IconData emailAlerts = PhosphorIconsBold.at;
  static const IconData soundAlerts = PhosphorIconsBold.speakerHigh;
  static const IconData support = PhosphorIconsBold.headset;
  static const IconData about = PhosphorIconsBold.info;
  static const IconData signOut = PhosphorIconsBold.signOut;

  /// Edit profile. The account itself, not a pencil: the row opens the
  /// resident's own details, and a pencil is the verb rather than the subject.
  static const IconData profile = PhosphorIconsBold.userCircle;

  /// One person in a directory — the HOA officer rows.
  static const IconData person = PhosphorIconsBold.user;

  /// Copy to clipboard.
  static const IconData copy = PhosphorIconsBold.copy;

  // ── App info ──
  /// Terms of service: a document.
  static const IconData terms = PhosphorIconsBold.fileText;

  /// Privacy policy. A shield, because the row is about what protects the
  /// resident's data rather than about the file that describes it.
  static const IconData privacy = PhosphorIconsBold.shieldCheck;
}
