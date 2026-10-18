// CupertinoPageTransitionsBuilder (used by _pageTransitions below) is declared
// in src/cupertino/route.dart and exported only by this library — material.dart
// references it in its own defaults and docs but does not re-export it, so
// importing material alone leaves it undefined.
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Fonts that are guaranteed to be present on the device.
///
/// This list is the difference between "the app looks slightly different" and
/// "the app renders nothing".
///
/// `GoogleFonts.nunitoSans()` returns a TextStyle whose `fontFamily` is Nunito
/// Sans and then fetches the actual font file from fonts.gstatic.com in the
/// background. Nothing in this project bundles it — there is no `fonts:`
/// section in pubspec.yaml and no `assets/google_fonts/` directory — so on a
/// device that is offline, on a throttled connection, or behind a firewall,
/// that family never becomes available. Every `Text` in the app is then asked
/// to lay out in a font that does not exist, with no fallback specified, and
/// the result is glyphs with no metrics: containers, borders and glass panels
/// still paint, but their text content collapses to nothing.
///
/// Naming a concrete fallback chain removes that failure mode entirely. The
/// text renders in the platform's own UI font instead, which is a cosmetic
/// downgrade rather than an unusable screen.
const List<String> kFontFallbacks = <String>[
  'Roboto', // Android
  '.SF UI Text', // iOS
  'Segoe UI', // Windows
  'sans-serif', // generic, always resolvable
];

/// The app's UI text style. Despite the name — kept so that every one of the
/// ~1,900 existing call sites keeps working — it resolves to **Nunito Sans**.
///
/// ── WHY NUNITO SANS, AND NOT INTER ────────────────────────────────────────
/// Because that is what the web portals actually render. Their `--font-sans`
/// token points at `--font-effra`, whose first family is "Nunito Sans" with
/// Inter only as the FALLBACK behind it (see the long note on that token in
/// web-portal/packages/shared/src/styles/index.css). Effra is the brief's
/// face; it is licensed per-seat with a separate web-embedding fee, so Nunito
/// Sans stands in for it there, chosen as a humanist substitute that holds up
/// at 11-14px where a geometric face like Poppins does not.
///
/// So "match the web" and "use Inter" are different instructions, and this
/// takes the first. Setting Inter here would put mobile on a face the portals
/// only fall back to, which is drift dressed up as parity. If the product
/// should instead be Inter everywhere, the change belongs in that CSS token
/// AND in this one line — not in this one line alone.
///
/// Falls back to the platform UI font when google_fonts cannot fetch; see
/// [kFontFallbacks].
TextStyle sfPro({
  TextStyle? textStyle,
  Color? color,
  Color? backgroundColor,
  double? fontSize,
  FontWeight? fontWeight,
  FontStyle? fontStyle,
  double? letterSpacing,
  double? wordSpacing,
  TextBaseline? textBaseline,
  double? height,
  Locale? locale,
  Paint? foreground,
  Paint? background,
  List<Shadow>? shadows,
  List<FontFeature>? fontFeatures,
  TextDecoration? decoration,
  Color? decorationColor,
  TextDecorationStyle? decorationStyle,
  double? decorationThickness,
}) {
  // Built first so it can be returned as-is if google_fonts is unusable.
  final base = TextStyle(
    color: color,
    backgroundColor: backgroundColor,
    fontSize: fontSize,
    fontWeight: fontWeight,
    fontStyle: fontStyle,
    letterSpacing: letterSpacing,
    wordSpacing: wordSpacing,
    textBaseline: textBaseline,
    height: height,
    locale: locale,
    foreground: foreground,
    background: background,
    shadows: shadows,
    fontFeatures: fontFeatures,
    decoration: decoration,
    decorationColor: decorationColor,
    decorationStyle: decorationStyle,
    decorationThickness: decorationThickness,
    fontFamilyFallback: kFontFallbacks,
  ).merge(textStyle);

  try {
    return GoogleFonts.nunitoSans(
      textStyle: textStyle,
      color: color,
      backgroundColor: backgroundColor,
      fontSize: fontSize,
      fontWeight: fontWeight,
      fontStyle: fontStyle,
      letterSpacing: letterSpacing,
      wordSpacing: wordSpacing,
      textBaseline: textBaseline,
      height: height,
      locale: locale,
      foreground: foreground,
      background: background,
      shadows: shadows,
      fontFeatures: fontFeatures,
      decoration: decoration,
      decorationColor: decorationColor,
      decorationStyle: decorationStyle,
      decorationThickness: decorationThickness,
      // The load-bearing addition. Without this the returned style names
      // Nunito Sans and nothing else, so an unfetched font leaves the engine
      // with no metrics to lay out against.
    ).copyWith(fontFamilyFallback: kFontFallbacks);
  } catch (_) {
    // google_fonts throws outright when runtime fetching is disabled and the
    // font is not bundled. Text must never depend on that succeeding.
    return base;
  }
}

/// The DISPLAY face — Plus Jakarta Sans — for the single largest heading on a
/// screen, and nothing else.
///
/// Mirrors the portals' `--font-display` token exactly, including its scope:
/// over there this face is used by exactly one element, the sign-in heading,
/// and the token's own documentation is emphatic that "anything that reaches
/// for it on a screen full of 14px text is using the wrong token". The same
/// restraint applies here. Mobile's one qualifying element is the
/// "Welcome back" / "Create your account" heading on the auth screens.
///
/// The reason a second face earns its place at all: a text face is drawn to
/// stay even at 11-16px, which is exactly what makes it unremarkable at 24px
/// and up. Plus Jakarta Sans has a taller x-height, rounder bowls and a real
/// ExtraBold, so a heading reads as a chosen typeface rather than as the body
/// font enlarged — while staying close enough in width and colour to sit
/// beside it without looking like a mistake.
///
/// Same fallback discipline as [sfPro]: an unfetched webfont degrades to the
/// platform UI font instead of rendering nothing.
TextStyle displayFont({
  double? fontSize,
  FontWeight? fontWeight,
  Color? color,
  double? letterSpacing,
  double? height,
}) {
  final base = TextStyle(
    fontSize: fontSize,
    fontWeight: fontWeight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
    fontFamilyFallback: kFontFallbacks,
  );

  try {
    return GoogleFonts.plusJakartaSans(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      letterSpacing: letterSpacing,
      height: height,
    ).copyWith(fontFamilyFallback: kFontFallbacks);
  } catch (_) {
    return base;
  }
}

TextStyle _sf({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color? color,
  double letterSpacing = -0.2,
  double height = 1.35,
}) {
  return sfPro(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}

/// ─────────────────────────── DESIGN TOKENS ───────────────────────────
/// Soft Modernism, green & white. Every color in the app flows through these
/// tokens — screens should never hardcode hex values.
///
/// ── THE INVERSION ─────────────────────────────────────────────────────────
/// This palette used to be an ultra-dark forest glassmorphism system, and the
/// names still carry that history: `glassFill`, `glassBorderLight`,
/// `midnightSurface`. The NAMES are load-bearing — sixty files read them — so
/// they are kept and repointed rather than renamed, and the meaning of each is
/// restated below. "Glass" now means a soft translucent white over the wash,
/// not a frosted panel over a dark shell.
///
/// The one thing to be careful of when reading this file: some tokens are the
/// SURFACE and some are what sits ON an accent. Those two invert in opposite
/// directions, which is why [onAccent] now exists rather than call sites
/// borrowing [background] for the job.
class AppColors {
  // ── THE CANVAS ──
  /// Primary screen surface — pure white.
  ///
  /// This was emerald-50 (`#F0FDF4`), a barely-there green wash, and cards sat
  /// crisp white on top of it. Now the canvas and the cards are the SAME white,
  /// which changes what separates them: fill no longer does any of that work,
  /// so a card is defined entirely by its hairline and its shadow. That makes
  /// [glassShadow] load-bearing rather than decorative — if a surface ever
  /// looks like it has merged into the page, it is missing one of those two,
  /// not missing a tint.
  static const Color background = Color(0xFFFFFFFF);

  /// Cards and sheets. Identical to [background] now; kept as a separate token
  /// because the two mean different things and will not always be equal.
  static const Color backgroundSecondary = Color(0xFFFFFFFF);
  static const Color backgroundElevated = Color(0xFFFFFFFF);

  // ── SOFT SURFACES (formerly the frosted-glass layer) ──
  /// Translucent white for panels floating over the wash or over a map.
  static const Color glassFill = Color(0xB3FFFFFF); // white @ 70%
  static const Color glassFillStrong = Color(0xF2FFFFFF); // white @ 95%

  /// Delicate emerald hairlines in place of the old bright-on-dark strokes.
  /// The directional pair is kept so panels can still read as lit from above,
  /// but the difference between them is now a whisper rather than a highlight.
  static const Color glassBorderTopLeft = Color(0xCCD1FAE5); // emerald-100/80
  static const Color glassBorderBottomRight = Color(0x99D1FAE5);

  /// Single-value hairline for call sites that only need one border color
  /// (dialogs, dividers, nav bar top edge).
  static const Color glassBorderLight = Color(0xCCD1FAE5);
  static const Color glassBorder = Color(0xCCD1FAE5);

  /// A neutral hairline for controls that should read as chrome rather than as
  /// part of the brand — the back button, the close button. Slate-200.
  ///
  /// Deliberately NOT a repoint of [glassBorderLight]: the emerald hairline is
  /// still correct on cards and panels, which are brand surfaces. A navigation
  /// affordance is not.
  static const Color borderNeutral = Color(0xFFE2E8F0); // slate-200

  /// The neutral (non-brand) control surface — close buttons, and the pressed
  /// state of the back button. Grey, because these are chrome: they dismiss and
  /// they navigate, they never carry brand meaning.
  static const Color neutralFill = Color(0xFFF1F5F9); // slate-100
  static const Color neutralFillPressed = Color(0xFFE2E8F0); // slate-200
  static const Color neutralIcon = Color(0xFF334155); // slate-700

  /// Slate-300 — a hairline that has to be SEEN rather than merely felt.
  ///
  /// [borderNeutral] (slate-200) is right for a resting edge on a white card.
  /// It is too faint for an empty radio bullet, where the ring is not trim
  /// around something else — it IS the control, and an unselected option the
  /// eye skips over is an option that does not look tappable.
  static const Color borderNeutralStrong = Color(0xFFCBD5E1); // slate-300

  /// Slate-100 — the faintest structural rule the app draws.
  ///
  /// For separators between LARGE regions that are already distinguished by
  /// position, where the line only has to stop two white areas from bleeding
  /// into each other: the underside of the dashboard header, section splits.
  /// Anything at [borderNeutral] weight there reads as a drawn box.
  ///
  /// Together with [borderNeutral] (200) and [borderNeutralStrong] (300) this
  /// is a three-step neutral scale: region rule → resting edge → control ring.
  static const Color borderNeutralSoft = Color(0xFFF1F5F9); // slate-100

  // `borderAccent` (emerald-100) lived here as the announcement/notification
  // card stroke. It is deleted rather than left unused: card borders are
  // [borderNeutral] slate-200 now — a card is structure, and structure does
  // not carry brand colour — and a spare emerald border token sitting in the
  // palette is an invitation to reintroduce exactly the inconsistency the
  // unified AppCard exists to prevent. Accent hairlines that genuinely need
  // the brand still have [innerStroke].

  /// `bg-emerald-50/50` — the pastel accent wash, flattened against white.
  ///
  /// Pre-composited rather than drawn at 50% alpha: these sit on opaque white
  /// cards, so the blend is knowable at author time, and a solid fill avoids
  /// a second translucent layer for the compositor to resolve on every frame
  /// of a scrolling feed.
  static const Color surfaceAccentSoft = Color(0xFFF5FEFA);

  /// `shadow-sm` — neutral black at 5%.
  ///
  /// This was `0x0D064E3B`, emerald-950 at 5%, and the comment above it argued
  /// that "a black-based shadow on a white surface reads as grime, not lift".
  /// That was true of the OLD canvas: over an emerald-50 wash a grey shadow
  /// went muddy, so tinting it to match the wash was the right call. The canvas
  /// is pure white now, and the same green tint that used to disappear into the
  /// background instead sits on it as a faint green halo around every card.
  /// Neutral grey is what a white page wants.
  static const Color glassShadow = Color(0x0D000000); // black @ 5%

  /// `shadow-md` — neutral black at 10%, for surfaces that float over content
  /// rather than sit in it (sheets, floating controls, sticky bars).
  static const Color shadowMedium = Color(0x1A000000); // black @ 10%

  // ── ACCENTS ──
  /// The brand green — primary actions, headers, selection chips, active
  /// tabs, status badges. **#047857, emerald-700.**
  ///
  /// ── IT WAS #16A34A, AND MOVING IT IS THE WHOLE COLOUR AUDIT ───────────
  /// `primary`, `headerSurface`, `ctaGreen` and `accent` are all aliases of
  /// this one constant, so the ~49 call sites across the post-login app were
  /// never 49 decisions — they were one, made here. Repointing it is the
  /// entire "standardise every green on the login screen's token" job, and
  /// doing it any other way would have meant 49 chances to miss one.
  ///
  /// ── IT ALSO CLOSES A DOCUMENTED AA FAILURE ────────────────────────────
  /// The note on [headerSurface] below used to record the trade this value
  /// forced: white on #16A34A measures 3.30:1, so the dashboard header's
  /// address line sat under the 4.5:1 floor for small text, and the only
  /// ways out were "return this to green-700, or take the subtitle to
  /// 18.66px bold". This is that first option, taken. White on #047857 is
  /// 5.60:1 and every string in the header clears AA.
  ///
  /// The auth screens reached #047857 independently, via `AuthTokens.brand`,
  /// for exactly the same contrast reason. The app and its threshold now
  /// agree instead of being two greens apart.
  static const Color accentPrimary = Color(0xFF047857); // emerald-700
  /// Soft mint for secondary controls and muted fills.
  static const Color accentSecondary = Color(0xFFA7F3D0); // emerald-200

  static const Color primary = accentPrimary;
  static const Color primaryLight = accentSecondary;
  static const Color primaryDark = Color(0xFF047857); // emerald-700

  // ── BRAND MARK INK ──
  /// The logo emblem on a light canvas — emerald-700, the same #047857 the
  /// portals' `--color-brand-logo` resolves to on white.
  ///
  /// Deliberately NOT [accentPrimary]. #16A34A is the *interaction* green: it
  /// means "this is a button, a selected tab, an active state". The mark is
  /// not an interaction, and at splash scale the vibrant green reads as a
  /// large tappable object rather than as an identity. Emerald-700 reads as
  /// ink, holds 5.5:1 on pure white, and keeps the two platforms' logos the
  /// same colour instead of approximately the same colour.
  static const Color brandMarkOnLight = primaryDark; // #047857
  /// The logo emblem on a dark canvas — the portals' creamy off-white.
  ///
  /// #FFFDD7 exactly: `--color-brand-logo` in the web portals' `.dark` block,
  /// and the value `BrandMark.jsx` names in its own header ("#05171B on light
  /// surfaces and #FFFDD7 on dark ones"). This was pure #FFFFFF, which is the
  /// obvious choice and the wrong one — a dead-white mark on near-black is
  /// the one combination that makes an emblem read as a system dialog rather
  /// than as a brand. The warm cast is three points of green and forty of
  /// blue off white; it is barely nameable in isolation and unmistakable
  /// beside the pure-white version.
  ///
  /// Not a tinted green either: #047857 on near-black measures under 3:1 and
  /// loses the thin negative-space channels between the four contours, which
  /// are the shape. Off-white holds 18.9:1.
  static const Color brandMarkOnDark = Color(0xFFFFFDD7);

  /// The dashboard header's solid green surface.
  ///
  /// [accentPrimary] exactly — the same #047857 as the active bottom-nav
  /// icons, the CTA buttons and the boundary stroke. One green in the app, no
  /// exceptions.
  ///
  /// ── THE CONTRAST TRADE, NOW RESOLVED ──────────────────────────────────────
  /// This block used to record a known AA failure and the two ways out of it.
  /// The first way out has been taken, so the failure is gone; the history is
  /// kept because it explains why the header is white-on-green at all.
  ///
  /// At the old #16A34A, white measured 3.30:1 here. The 19px w800 greeting
  /// passed as WCAG "large text" (floor 3:1) and the 13.5px w500 address line
  /// did NOT — it owed 4.5:1. The note said the options were "return this to
  /// green-700, or take the subtitle to 18.66px bold".
  ///
  ///   greeting   19px w800 white    5.60:1  PASSES
  ///   subtitle   13.5px w500 white  5.60:1  PASSES — was 3.30:1
  ///   bell glyph white on white/15  far past the 3:1 graphic floor
  ///
  /// The subtitle stays WHITE rather than returning to the pastel green it
  /// once was: green-100 on this surface is still the weaker pairing, and
  /// white now has margin to spare.
  static const Color headerSurface = accentPrimary; // #047857
  static const Color primarySoft = Color(0x1A047857); // emerald-700 @ 10%
  static const Color lightSky = accentSecondary;

  static const Color ctaGreen = accentPrimary;
  static const Color ctaGreenLight = accentSecondary;
  static const Color accent = accentPrimary;
  static const Color accentDark = primaryDark;

  /// What goes ON a filled accent — label text, icons inside a green pill.
  ///
  /// New, and the reason it exists is a trap this inversion set: call sites
  /// used [background] for this, which worked only because the surface used to
  /// be near-black. Flipping the surface to near-white would have silently
  /// turned every one of those into white-on-emerald by luck rather than by
  /// intent, and white-on-white anywhere the accent was dark.
  static const Color onAccent = Color(0xFFFFFFFF);

  // ── Map: route + water ──
  static const Color bermudaBlue = Color(0xFF0EA5E9);
  static const Color bermudaBlueDark = Color(0xFF0284C7);

  // ── Emergency ──
  /// Red-600. Deepened from the old coral, which was tuned to glow on a dark
  /// shell and goes washed-out and low-contrast against white.
  static const Color panicOxblood = Color(0xFFDC2626);
  static const Color panicGlowOuter = Color(0x33DC2626);

  // ── Semantic feedback palette ──
  static const Color success = Color(0xFF16A34A);
  static const Color warning = Color(0xFFF59E0B); // amber-500, "pending"
  static const Color danger = Color(0xFFDC2626);

  // ── Semantic INK: the same hues, one step down, for text ──────────────────
  //
  // The three tokens above are fills. They are correct behind an icon, a dot,
  // or a status plate, and they are wrong as small type on white: [success]
  // measures 3.30:1 there and [warning] 2.15:1, against the 4.5:1 that body
  // text owes. Tinting the text is not optional decoration — a resident who
  // skims past "evidence could not be uploaded" believes dispatch can see a
  // photo that is not there.
  //
  // home_screen.dart had already derived exactly this step privately, as
  // `_pillVerifiedInk` / `_pillPendingInk` / `_pillRejectedInk`, to make its
  // status pills legible. Those constants were file-private, so every other
  // screen with the same problem had no way to reach them and reached for the
  // fill instead. These are that convention, promoted to the palette so the
  // answer is shared rather than rediscovered.
  //
  // Pair each with its fill: [warning] behind the icon, [warningInk] on the
  // label.
  static const Color successInk = Color(0xFF166534); // green-800
  static const Color warningInk = Color(0xFF92400E); // amber-800
  static const Color dangerInk = Color(0xFF9F1239); // rose-800

  /// Sky-800, the ink for [info].
  ///
  /// [info] is the worst offender of the four as type: sky-500 measures
  /// 2.77:1 on white and 2.59:1 on the 7% wash the sign-up terms notice
  /// paints behind it. The ink measures 7.06:1 on that same wash.
  static const Color infoInk = Color(0xFF075985);

  /// The text-safe counterpart of a semantic fill, or the colour itself when
  /// it is already safe.
  ///
  /// Several widgets — `_MetaChip` on the notification tiles, the announcement
  /// category badge — are handed exactly ONE colour and then paint three
  /// things with it: a wash at 10–20%, a hairline, and a label on top. That
  /// cannot work, because the label is then the same hue as the surface
  /// directly behind it. Measured on their own washes, every semantic fill
  /// fails: at 10% the labels run 1.99:1 (warning) to 4.13:1 (danger), and at
  /// 20% they run 1.85:1 to 3.53:1, against the 4.5:1 small text owes.
  ///
  /// Mapping fill → ink here rather than at each call site means a widget
  /// keeps taking one colour, and every present and future caller gets the
  /// legible pairing for free. Pass the fill to the container and
  /// `inkFor(fill)` to the glyph and the label.
  ///
  /// Colours with no semantic partner return unchanged — [textSecondary],
  /// `_MetaChip`'s own default, already measures 6.53:1 on its 10% wash and
  /// needs no correction.
  static Color inkFor(Color fill) {
    // The aliases collapse by value: success == ctaGreen == accentPrimary,
    // danger == panicOxblood, warning == rating.
    if (fill == success) return successInk;
    if (fill == warning) return warningInk;
    if (fill == danger) return dangerInk;
    if (fill == info) return infoInk;
    return fill;
  }

  /// `bg-rose-500` — the swipe-to-delete plate revealed behind a card.
  ///
  /// Deliberately NOT [danger] (red-600). That token means "something is
  /// wrong": failed writes, validation errors, a rejected account. Deleting a
  /// notification is not an error, it is a choice, and reusing the error red
  /// for it teaches the palette's loudest colour to mean two different things.
  /// Rose is a shade warmer and a shade brighter, which is also what makes the
  /// Instagram-style reveal read as an action rather than an alarm.
  static const Color swipeDelete = Color(0xFFF43F5E); // rose-500
  static const Color info = Color(0xFF0EA5E9);

  // ── Rating accent ──
  static const Color rating = Color(0xFFF59E0B);

  // ── Structural surfaces (flat, non-glass) ──
  static const Color surface = backgroundSecondary;
  static const Color surfaceElevated = backgroundElevated;
  static const Color inputFill = Color(0xFFFFFFFF);
  static const Color innerStroke = Color(0xCCD1FAE5);
  static const Color divider = Color(0xCCD1FAE5);

  // ── Card surfaces (legacy name, repointed) ──
  static const Color glassLight = glassFillStrong;

  // ── Legacy aliases (so existing refs compile against the new theme) ──
  // The `midnight*` names are historical. They no longer describe anything —
  // kept only so the screens that still reference them keep resolving.
  static const Color bgLight = background;
  static const Color surfaceLight = backgroundSecondary;
  static const Color midnightBase = background;
  static const Color midnightSurface = backgroundSecondary;
  static const Color midnightSurfaceElevated = backgroundElevated;
  static const Color midnightInputFill = inputFill;

  // ── TYPOGRAPHY & CONTRAST ──
  /// Deep emerald for headers and body copy — 13:1 against the wash.
  /// `text-slate-900`. 17.9:1 on white.
  ///
  /// Was #064E3B (emerald-950) — a green-black. That tinted every heading and
  /// every body line in the app faintly green, which read as a palette rather
  /// than as ink, and it disagreed with the web portals, which have used
  /// slate-900 since their own design-system pass. This is the change that
  /// makes the two platforms' typography actually identical rather than
  /// approximately so.
  ///
  /// GLOBAL, not scoped to one screen: this token is the app's default text
  /// colour, so the switch reaches every surface. Contrast improves everywhere
  /// (9.1:1 → 17.9:1); nothing regresses.
  static const Color textPrimary = Color(0xFF0F172A); // slate-900
  /// Slate for secondary labels.
  static const Color textSecondary = Color(0xFF475569); // slate-600
  /// Muted slate for captions and secondary metadata.
  ///
  /// Was slate-400 (`#94A3B8`), which measures 2.56:1 on white — under the
  /// 4.5:1 WCAG AA floor for body and placeholder text, and under even the
  /// 3:1 large-text floor. Seven of this token's call sites are `hintStyle`
  /// on real text fields (login, sign-up, forgot- and change-password, report
  /// incident, location search, verify property), where a placeholder the eye
  /// slides off is a form that looks empty when it is not.
  ///
  /// Slate-500 measures 4.76:1 and clears AA at every size. It is one rung
  /// down the same ramp, so the hierarchy is unchanged — muted still reads as
  /// muted underneath [textSecondary]'s 7.58:1.
  static const Color textMuted = Color(0xFF64748B); // slate-500

  /// Genuinely inert text — a disabled control's label, never a caption.
  ///
  /// Split out from [textMuted], which had been one token doing two jobs.
  /// Disabled text is exempt from the AA floor precisely because looking
  /// unavailable is the point; caption text is not. Holding the old slate-400
  /// here keeps that "switched off" read for the sites that actually want it,
  /// instead of forcing them up the ramp with the captions.
  static const Color textDisabled = Color(0xFF94A3B8); // slate-400

  // The `OnDark` suffix is historical — there is no dark surface left to
  // contrast against, so these resolve to the same ramp as everything else.
  static const Color textPrimaryOnDark = textPrimary;
  static const Color textSecondaryOnDark = textSecondary;
  static const Color textMutedOnDark = textMuted;

  static const Color onGlassPrimary = textPrimary;
  static const Color onGlassSecondary = textSecondary;
  static const Color onGlassMuted = textMuted;

  /// Emerald for critical data and status indicators sitting in body copy.
  static const Color textAccent = Color(0xFF047857);
}

/// Background treatment for the app's main shell — a soft white-to-mint wash
/// so white cards have something to lift off without any hard boundary.
/// The app's elevation scale. Two steps, both neutral.
///
/// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
/// Elevation used to be written inline at every call site, and roughly twenty
/// of them reached for the BRAND colour to do it: `AppColors.primary` at 25%,
/// at 30%, at 35%, a `tinted` at 42%, a `brand` at 18%. Each one was a green
/// glow pooling under a button or a card. Individually they read as polish;
/// together they gave the whole app a faint green haze that got worse the more
/// components a screen had, and no two agreed on the alpha.
///
/// Colour is for meaning here — emerald says "primary action", red says
/// "emergency". A shadow is not meaning, it is depth, and depth is grey.
///
/// [sm] for things that sit ON the page (cards, inputs, the back button).
/// [md] for things that float OVER it (sheets, map controls, sticky bars).
///
/// The one deliberate exception in the codebase is the SOS button's red glow.
/// That is not decoration — it is the panic affordance signalling danger, and
/// neutralising it would quietly downgrade a safety cue. See
/// `curved_bottom_nav.dart`.
class AppShadows {
  AppShadows._();

  static const List<BoxShadow> sm = [
    BoxShadow(
      color: AppColors.glassShadow,
      blurRadius: 8,
      offset: Offset(0, 2),
    ),
  ];

  static const List<BoxShadow> md = [
    BoxShadow(
      color: AppColors.shadowMedium,
      blurRadius: 16,
      offset: Offset(0, 4),
    ),
  ];
}

class AppGradients {
  /// The app shell.
  ///
  /// FLAT WHITE, despite still being a LinearGradient. It ran white →
  /// emerald-50 → emerald-100 diagonally, which is the "soft green wash" the
  /// whole palette was built on; the unified-white spec removes it. The type is
  /// kept rather than swapped for a Color so `GradientScaffold` and its ~15
  /// call sites do not all have to change shape for a decision that may well
  /// come back — reintroducing a wash is an edit to these three stops.
  static const LinearGradient shell = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
      Color(0xFFFFFFFF),
      Color(0xFFFFFFFF),
      Color(0xFFFFFFFF),
    ],
    stops: [0.0, 0.55, 1.0],
  );
}

class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
  static const double xxxl = 64;

  // ── ON THE GRID ──────────────────────────────────────────────────────────
  // These two were 20, the only values in this class off the 8px step (every
  // other one is 4, 8, 16, 24, 32, 48, 64, 120 — all multiples of 8 bar the
  // deliberate 4px half-step). 20 is a 2.5-step: it never lines up with a
  // sibling using [md], so a card at 20 and a row gap at 16 were permanently
  // 4px out of register down the length of every screen.
  //
  // Both go to 16 — 2x8, and the gutter Material specifies for phones. That
  // widens usable content by 8px per screen, which on a 390pt device is a
  // visible gain for the address lines and incident descriptions that were
  // wrapping early. Going the other way (24) would have been equally on-grid
  // but costs 8px of content on the app's most cramped screens.
  static const double screenGutter = 16;
  static const double cardPadding = 16;
  static const double navClearance = 120;
}

/// Border widths.
///
/// Exists because 1.5 is a real, named value in this design system and it is
/// a STROKE, not a radius. It briefly lived on [AppRadius] as a 1.5px corner;
/// that was a misreading — the announcement and notification cards are
/// `rounded-[5px] border-[1.5px]`, i.e. [AppRadius.xxs] corners with a
/// slightly-heavier-than-hairline edge.
///
/// The distinction matters beyond pedantry: at 1.5 logical px a *radius* is
/// invisible (the cards read as squares), whereas a 1.5px *stroke* is clearly
/// heavier than the 1px default and is what gives these cards their crisp,
/// deliberately-outlined look.
/// How TYPED text behaves in every input in the app.
///
/// ── ONE PLACE, BECAUSE THERE ARE NINE FILES OF INPUTS ─────────────────────
/// Sign-up, login, forgot-password, change-password, edit-profile, the report
/// form, the address search and the shared field widgets each declare their own
/// `style:` on a TextField. Nothing connected them, so "make typed text bolder"
/// was nine independent edits that would drift back apart on the tenth field
/// somebody adds. These are the two decisions that have to hold across all of
/// them.
class AppInput {
  AppInput._();

  /// The weight of what the resident types.
  ///
  /// Semi-bold, one step up from the regular the fields used to set. Typed text
  /// is the only content on these screens the resident authored, and at w400 it
  /// sat at the same weight as the hint it replaced — so a filled field and an
  /// empty one read the same at a glance. Weight is what separates an answer
  /// from a prompt.
  static const FontWeight weight = FontWeight.w600;

  /// The character a password field masks with.
  ///
  /// U+25CF BLACK CIRCLE, not Flutter's default U+2022 BULLET. The bullet is a
  /// typographic mid-dot sized for running text — against a 15px field it is a
  /// speck, and a resident checking they typed the right number of characters
  /// is squinting at it. The black circle is the glyph iOS and Android use in
  /// their own passcode fields, and it fills the line the way a mask should.
  static const String obscuringCharacter = '●';

  /// Tracking for masked text.
  ///
  /// Applied ONLY while obscured. Circles set with the letter spacing of prose
  /// run together into a bar; this is what keeps them countable, which is the
  /// single thing a mask has to support.
  static const double obscuredSpacing = 2.5;
}

class AppStroke {
  AppStroke._();

  /// Default hairline — every surface that is not an announcement or
  /// notification card.
  static const double hairline = 1;

  /// `border-[1.5px]`. Announcement cards, notification tiles, and the media
  /// containers inside them.
  static const double card = 1.5;
}

class AppRadius {
  /// `rounded-[5px]`. The softest corner the app draws — just enough to take
  /// the bite off a right angle without reading as "rounded".
  ///
  /// For large structural surfaces (the dashboard header card) and the square
  /// controls sitting inside them, where anything at [xs] and above starts to
  /// look like a pill and fights the rectilinear grid the surface establishes.
  static const double xxs = 5;

  static const double xs = 8;
  static const double sm = 12;
  static const double md = 14;
  static const double lg = 18;
  static const double xl = 24;
  static const double pill = 999;
}

class AppIconSize {
  static const double xs = 14;
  static const double sm = 18;
  static const double md = 22;
  static const double lg = 28;
  static const double xl = 36;
}

class AppText {
  static TextStyle get display => _sf(
        size: 28,
        weight: FontWeight.w700,
        color: AppColors.textPrimary,
        letterSpacing: -0.5,
        height: 1.2,
      );

  static TextStyle get headline => _sf(
        size: 22,
        weight: FontWeight.w700,
        color: AppColors.textPrimary,
        letterSpacing: -0.3,
        height: 1.25,
      );

  static TextStyle get title => _sf(
        size: 17,
        weight: FontWeight.w600,
        color: AppColors.textPrimary,
        letterSpacing: -0.2,
        height: 1.3,
      );

  static TextStyle get subtitle => _sf(
        size: 15,
        weight: FontWeight.w600,
        color: AppColors.textPrimary,
        letterSpacing: -0.15,
        height: 1.35,
      );

  static TextStyle get body => _sf(
        size: 14,
        weight: FontWeight.w400,
        color: AppColors.textSecondary,
        letterSpacing: -0.1,
        height: 1.5,
      );

  static TextStyle get bodyStrong => _sf(
        size: 14,
        weight: FontWeight.w600,
        color: AppColors.textPrimary,
        letterSpacing: -0.1,
        height: 1.45,
      );

  static TextStyle get caption => _sf(
        size: 12,
        weight: FontWeight.w500,
        color: AppColors.textMuted,
        letterSpacing: 0,
        height: 1.4,
      );

  static TextStyle get overline => _sf(
        size: 11,
        weight: FontWeight.w600,
        color: AppColors.textMuted,
        letterSpacing: 0.6,
        height: 1.4,
      );

  static TextStyle get button => _sf(
        size: 15,
        weight: FontWeight.w600,
        letterSpacing: -0.1,
      );
}

class AppTheme {
  static ThemeData get theme => darkTheme;

  static const _pageTransitions = PageTransitionsTheme(
    builders: {
      TargetPlatform.android: CupertinoPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    },
  );

  /// The app's single theme.
  ///
  /// Still named `darkTheme` because `app.dart` and a handful of call sites
  /// reference it; the name is now a misnomer kept for compatibility, not a
  /// description. There is one theme, it is light, and `themeMode` is pinned
  /// to `ThemeMode.light` in `app.dart` — [ThemeModeController]'s stored
  /// preference is read but has never been wired to MaterialApp.
  static ThemeData get darkTheme {
    final base = ThemeData.light(useMaterial3: true);
    // Same reasoning as sfPro: every Material text style must name a fallback
    // that actually exists on the device, or an unfetched webfont leaves the
    // whole theme laying out against a font that was never registered.
    TextTheme textBase;
    try {
      textBase = GoogleFonts.nunitoSansTextTheme(base.textTheme)
          .apply(fontFamilyFallback: kFontFallbacks);
    } catch (_) {
      textBase = base.textTheme.apply(fontFamilyFallback: kFontFallbacks);
    }
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.background,
      colorScheme: base.colorScheme.copyWith(
        brightness: Brightness.light,
        primary: AppColors.accentPrimary,
        // White on emerald, not the surface colour. Under the old dark palette
        // `background` happened to be the right contrast for this slot; under
        // a light one it is the same value as the button's own backdrop.
        onPrimary: AppColors.onAccent,
        secondary: AppColors.accentSecondary,
        onSecondary: AppColors.textPrimary,
        surface: AppColors.backgroundSecondary,
        onSurface: AppColors.textPrimary,
        error: AppColors.danger,
        onError: AppColors.onAccent,
      ),
      pageTransitionsTheme: _pageTransitions,
      textTheme: textBase.copyWith(
        displaySmall: textBase.displaySmall?.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w700,
        ),
        headlineSmall: textBase.headlineSmall?.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w700,
        ),
        titleMedium: textBase.titleMedium?.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w700,
        ),
        titleSmall: textBase.titleSmall?.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w600,
        ),
        bodyLarge: textBase.bodyLarge?.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w500,
        ),
        bodyMedium: textBase.bodyMedium?.copyWith(
          color: AppColors.textSecondary,
          fontWeight: FontWeight.w400,
        ),
        bodySmall: textBase.bodySmall?.copyWith(
          color: AppColors.textSecondary,
          fontWeight: FontWeight.w400,
        ),
        labelLarge: textBase.labelLarge?.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w600,
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        toolbarHeight: 56,
        titleTextStyle: AppText.title.copyWith(
          color: AppColors.textPrimary,
          fontWeight: FontWeight.w700,
        ),
        iconTheme: const IconThemeData(
          color: AppColors.textPrimary,
          size: AppIconSize.sm,
        ),
        actionsIconTheme: const IconThemeData(
          color: AppColors.textPrimary,
          size: AppIconSize.sm,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.inputFill,
        hintStyle: sfPro(
          color: AppColors.textMuted,
          fontSize: 14,
          letterSpacing: -0.1,
        ),
        labelStyle: sfPro(
          color: AppColors.textSecondary,
          fontSize: 13,
          fontWeight: FontWeight.w500,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 16,
        ),
        // Pill-shaped inputs and search bars, per the Soft Modernism spec.
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          borderSide: const BorderSide(color: AppColors.innerStroke, width: 1),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          borderSide: const BorderSide(color: AppColors.innerStroke, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          borderSide:
              const BorderSide(color: AppColors.accentPrimary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          borderSide: const BorderSide(color: AppColors.danger),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          borderSide: const BorderSide(color: AppColors.danger, width: 1.5),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accentPrimary,
          foregroundColor: AppColors.onAccent,
          disabledBackgroundColor:
              AppColors.accentPrimary.withValues(alpha: 0.35),
          disabledForegroundColor:
              AppColors.onAccent.withValues(alpha: 0.75),
          textStyle: AppText.button,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: 16,
          ),
          // Pill, per spec: every interactive button is fully rounded.
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.pill),
          ),
          elevation: 0,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.accentPrimary,
          textStyle: sfPro(
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.innerStroke,
        thickness: 1,
        space: 28,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.backgroundSecondary,
        selectedItemColor: AppColors.accentPrimary,
        unselectedItemColor: AppColors.textMuted,
        type: BottomNavigationBarType.fixed,
        showUnselectedLabels: true,
      ),
    );
  }

  static ThemeData get lightTheme => darkTheme;
}
