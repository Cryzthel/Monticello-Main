import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/brand/brand_mark.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// The two colours the first-run surfaces are built from.
///
/// ── ONE PALETTE, ON EVERY DEVICE ──────────────────────────────────────────
/// This used to resolve from `MediaQuery.platformBrightnessOf` and carry a
/// dark variant: #09090B with the portals' creamy #FFFDD7 mark. The dark
/// branch is gone by request — the splash is white with the emerald mark
/// whatever the system appearance is set to.
///
/// What went with it, so nothing is left half-wired:
///
///   • `forBrightness`, `of(context)`, `isDark` and the `brightness` field;
///   • the cross-fade that existed to carry the canvas and the ink between
///     the two palettes when the system switch was flipped mid-session;
///   • `android/app/src/main/res/values-night/` in its entirety;
///   • the `luminosity: dark` appearance on the iOS SplashCanvas colorset.
///
/// `AppColors.brandMarkOnDark` stays defined — the portals still use that
/// value and the token documents the brand fact — but nothing on mobile
/// reads it now.
///
/// ── THE OVERLAY STYLE IS STILL NEEDED ─────────────────────────────────────
/// `main()` sets one global [SystemUiOverlayStyle] with LIGHT status-bar
/// icons, which paints white glyphs onto this white canvas. The
/// `AnnotatedRegion` below overrides it while the splash is on top and hands
/// it back afterwards, so this class survives the simplification rather than
/// collapsing into two bare constants.
@immutable
class SplashPalette {
  const SplashPalette._();

  /// Pure white. Not `AppColors.background` (a faint slate wash): the splash
  /// is the one surface with nothing on it but the mark, and a tinted canvas
  /// behind a single centred emblem reads as a slightly dirty screen rather
  /// than as a palette choice.
  static const Color canvas = Color(0xFFFFFFFF);

  /// Emerald-700, the same #047857 the portals resolve `--color-brand-logo`
  /// to on a light surface.
  static const Color ink = AppColors.brandMarkOnLight;

  /// Dark status-bar and navigation glyphs, to sit on the white canvas.
  static const SystemUiOverlayStyle overlayStyle = SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarBrightness: Brightness.light, // iOS
    statusBarIconBrightness: Brightness.dark, // Android
    systemNavigationBarColor: canvas,
    systemNavigationBarDividerColor: canvas,
    systemNavigationBarIconBrightness: Brightness.dark,
  );
}


/// The adaptive first-run canvas: a full-bleed background that follows the
/// device appearance, with its single child centred in the viewport.
///
/// ── THIS IS THE ONBOARDING SEAM ───────────────────────────────────────────
/// Split out from [SplashView] rather than inlined into it, because the
/// three-step introductory sequence that comes next needs exactly this and
/// nothing else from the splash: the same two colours, the same cross-fade,
/// the same system-bar handling. A `SplashCanvas` wrapped around a `PageView`
/// is an onboarding flow that already matches the screen it launched from, and
/// the handoff costs no cross-fade at all because the background widget never
/// unmounts between the two.
///
/// It takes a `builder` and not a `child` so the content can read the resolved
/// palette — a step indicator, a "Next" button and body copy all need the ink
/// colour, and threading it through a builder keeps the resolution in one place
/// instead of making every caller re-derive it from the platform brightness.
class SplashCanvas extends StatelessWidget {
  const SplashCanvas({
    super.key,
    required this.builder,
    this.center = true,
  });

  /// Takes a plain builder now that there is no palette to hand it. It kept
  /// a `SplashPalette` parameter while the colours could change under it;
  /// with one palette the values are constants any caller can read directly.
  final WidgetBuilder builder;

  /// Centre the child in the viewport. True for the splash's single emblem;
  /// onboarding will want its own column and should pass false.
  final bool center;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SplashPalette.overlayStyle,
      // A plain ColoredBox. There was a `TweenAnimationBuilder` here to
      // cross-fade the canvas when the system appearance changed mid-session;
      // with one palette there is nothing to fade between, and an animation
      // whose two ends are the same colour is seventeen frames of work to
      // repaint an identical rectangle.
      child: ColoredBox(
        color: SplashPalette.canvas,
        child: SizedBox.expand(
          // No SafeArea. The emblem is a single centred element that cannot
          // collide with a notch or a gesture bar, and insetting the canvas
          // would centre the mark in the space *below* the status bar rather
          // than on the screen — which, on a layout whose only requirement is
          // "perfectly centred", is the entire layout.
          child: center
              ? Center(child: Builder(builder: builder))
              : Builder(builder: builder),
        ),
      ),
    );
  }
}

/// The first landing surface: the brand emblem, centred, on an adaptive canvas.
/// Nothing else.
///
/// ── WHAT CAME OFF IT ──────────────────────────────────────────────────────
/// A 100px rounded tile holding a Phosphor shield glyph, the "Monticello
/// Villas" wordmark, a `SECURE • VERIFIED • CONNECTED` tagline, a spinning leaf
/// and a version number — six stacked elements, none of them the logo. The
/// shield was a stand-in for a mark that had not been wired up on mobile;
/// [BrandMark] is now the real artwork, so the stand-in has nothing left to
/// stand in for, and with the real mark present the four lines of type under it
/// were saying out loud what the emblem already says.
///
/// The version number is the one real loss. It was the quickest way to confirm
/// which build a device is running without digging through Settings, and it is
/// genuinely useful when a tester reports something. It is hard-coded 'v1.0.0'
/// text rather than anything read from the package, though, so it was already
/// capable of lying — and Settings shows the real build. Worth restoring there
/// rather than here if it is missed.
///
/// Presentational and self-contained: no navigation, no futures, no Firebase.
/// That is what lets [SplashScreen] and `AuthGate`'s start-up wait render the
/// identical screen, which in turn is what makes the cold-start sequence read
/// as one continuous surface instead of three that resemble each other.
class SplashView extends StatefulWidget {
  const SplashView({
    super.key,
    this.animateIn = true,
    this.markHeight = 88,
  });

  /// Fade and settle the emblem on mount.
  ///
  /// Pass false where this screen is a *continuation* rather than an entrance
  /// — re-running the entrance on a screen the user is already looking at
  /// reads as a flicker, not as polish.
  final bool animateIn;

  /// Height of the emblem. Width follows the artwork's 192:179 ratio.
  ///
  /// 88, down from 104. The brief's figure is a 96x96 SQUARE, and this mark
  /// is wider than it is tall — so matching that box means sizing the larger
  /// dimension to it, not the smaller. At 88 tall the emblem is 94 wide,
  /// which lands just inside a 96 square; setting the HEIGHT to 96 would
  /// have produced a 103pt-wide mark, overshooting the box it was meant to
  /// fit.
  final double markHeight;

  @override
  State<SplashView> createState() => _SplashViewState();
}

class _SplashViewState extends State<SplashView>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 620),
    );

    // Opacity leads and finishes early; scale runs the full duration and
    // settles. The mark is therefore fully opaque while it is still coming to
    // rest, which is what makes the motion read as the emblem *arriving*
    // rather than as a cross-fade.
    _opacity = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0, 0.55, curve: Curves.easeOut),
    );

    // 0.94 -> 1.0, and easeOutCubic rather than the easeOutBack this screen
    // used to overshoot on. A logo that bounces is a logo doing a trick; six
    // per cent of settle is the most this should ask for.
    _scale = Tween<double>(begin: 0.94, end: 1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );

    if (widget.animateIn) {
      _controller.forward();
    } else {
      _controller.value = 1;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SplashCanvas(
      builder: (context) {
        // One colour, so the mark is drawn rather than tweened. The tween it
        // replaces existed to carry the ink between the light and dark
        // palettes in step with the canvas.
        final mark = BrandMark(
          height: widget.markHeight,
          color: SplashPalette.ink,
          // The emblem stands completely alone here — there is no wordmark
          // beside it to announce the brand, so this is the one place the
          // mark is content rather than decoration.
          semanticLabel: 'Monticello Villas',
        );

        if (!widget.animateIn) return mark;

        return FadeTransition(
          opacity: _opacity,
          child: ScaleTransition(scale: _scale, child: mark),
        );
      },
    );
  }
}
