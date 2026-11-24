import 'dart:math' show min;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/core/brand/brand_mark.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/features/auth/widgets/auth_controls.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, this.onCompleted});

  /// Invoked instead of navigating, when this screen is rendered as part of a
  /// reactive tree (see AuthGate) rather than pushed as a route.
  ///
  /// Navigating away is wrong in that context: `pushReplacementNamed('/login')`
  /// would replace the ROOT route, tearing out the AuthGate that is supposed to
  /// swap the tree once the user signs in — leaving them stranded on a login
  /// screen that never transitions.
  final VoidCallback? onCompleted;

  static const _seenKey = 'onboarding_seen_v1';

  static Future<bool> hasSeen() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(_seenKey) ?? false;
    } catch (_) {
      return false;
    }
  }

  static Future<void> markSeen() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_seenKey, true);
    } catch (_) {}
  }

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with SingleTickerProviderStateMixin {
  final PageController _pageController = PageController();
  int _index = 0;

  static const _pages = [
    _OnboardPage(
      theme: _PageTheme.security,
      eyebrow: 'REAL-TIME SAFETY',
      title: 'Report incidents\nin seconds.',
      subtitle:
          'Instantly alert HOA security with GPS-pinned reports. Every submission is timestamped, categorized, and tracked end-to-end.',
      art: 'assets/onboarding/report_incidents.svg',
    ),
    _OnboardPage(
      theme: _PageTheme.community,
      eyebrow: 'COMMUNITY UPDATES',
      title: 'Never miss an\nannouncement.',
      subtitle:
          'Official HOA circulars, village alerts, and administrative notices delivered instantly to your device—always organized, never lost.',
      art: 'assets/onboarding/announcements.svg',
    ),
    _OnboardPage(
      theme: _PageTheme.emergency,
      eyebrow: 'OFFLINE FAILOVER',
      title: 'Emergency help,\neven offline.',
      subtitle:
          'The Panic Button works without internet. One tap deploys an automated SMS emergency protocol directly to village guards.',
      art: 'assets/onboarding/emergency_offline.svg',
    ),
  ];

  bool get _isLast => _index == _pages.length - 1;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  /// Leaves onboarding. Synchronous by design.
  ///
  /// This previously `await`ed [OnboardingScreen.markSeen] before moving on.
  /// That put a SharedPreferences write on the critical path of the "Get
  /// Started" button: if the plugin throws the write is swallowed, and if it
  /// HANGS the await never completes — either way the user taps the button and
  /// nothing happens, with no error to show for it.
  ///
  /// Remembering that onboarding was seen is a convenience for the next
  /// launch. It is not a precondition for leaving this screen, so it is now
  /// fired without being awaited.
  void _finish() {
    OnboardingScreen.markSeen();

    final onCompleted = widget.onCompleted;
    if (onCompleted != null) {
      onCompleted();
      return;
    }
    Navigator.of(context).pushReplacementNamed('/login');
  }

  void _next() {
    if (_isLast) {
      _finish();
      return;
    }
    _pageController.nextPage(
      duration: const Duration(milliseconds: 380),
      curve: Curves.fastOutSlowIn,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.midnightBase : AppColors.background;

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: Column(
          children: [
            // ── Top bar ──────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 16, 0),
              child: Row(
                children: [
                  // Flexible, because this Row was unbounded beside a
                  // Spacer and a Skip button: at a large text scale the
                  // wordmark pushed the whole header past the right edge and
                  // painted the overflow stripe across the first screen a
                  // new resident ever sees. The mark keeps its size; the
                  // words give way.
                  Flexible(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // The real emblem — the last of the shield stand-ins,
                        // which the splash and both auth screens have already
                        // given up. A green tile with a glyph in it beside the
                        // words "Monticello Villas" was a lockup of a logo
                        // that was not the logo.
                        const BrandMark(height: 22, color: AuthTokens.brand),
                        const SizedBox(width: 10),
                        Flexible(
                          child: Text(
                            'Monticello Villas',
                            overflow: TextOverflow.ellipsis,
                            style: sfPro(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  AnimatedOpacity(
                    opacity: _isLast ? 0 : 1,
                    duration: const Duration(milliseconds: 200),
                    child: TextButton(
                      onPressed: _isLast ? null : _finish,
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.textMuted,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(
                        'Skip',
                        style: sfPro(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // ── Carousel ─────────────────────────────────────────────
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                onPageChanged: (i) => setState(() => _index = i),
                itemCount: _pages.length,
                itemBuilder: (context, i) =>
                    _OnboardSlide(page: _pages[i], isDark: isDark),
              ),
            ),

            // ── Bottom controls ───────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 36),
              child: Column(
                children: [
                  // Dot indicators
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(_pages.length, (i) {
                      final active = i == _index;
                      final color = _pages[i].theme.indicatorColor;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.fastOutSlowIn,
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        height: 6,
                        width: active ? 28 : 8,
                        decoration: BoxDecoration(
                          color: active
                              ? color
                              : AppColors.midnightSurfaceElevated,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 28),

                  // CTA button
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.fastOutSlowIn,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        // Neutral. This took the CURRENT PAGE's accent at 38%,
                        // so the CTA's glow changed hue as you swiped through
                        // onboarding — the one place a coloured shadow was
                        // doing something deliberate, and also the first thing
                        // a new resident ever sees. It is a shadow; grey.
                        boxShadow: AppShadows.md,
                      ),
                      child: ElevatedButton(
                        onPressed: _next,
                        style: ElevatedButton.styleFrom(
                          backgroundColor:
                              _pages[_index].theme.indicatorColor,
                          foregroundColor: AppColors.background,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(AppRadius.md),
                          ),
                        ),
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 220),
                          child: Text(
                            _isLast ? 'Get Started' : 'Continue',
                            key: ValueKey(_isLast),
                            style: sfPro(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: AppColors.background,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Slide widget ───────────────────────────────────────────────────────────────

class _OnboardSlide extends StatelessWidget {
  final _OnboardPage page;
  final bool isDark;

  const _OnboardSlide({
    required this.page,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        final maxH = constraints.maxHeight;
        // Height was ignored before, so short PageView viewports overflowed and
        // clipped the hero card. Cap by both width and available height.
        final dim = min(min(maxW * 0.76, maxH * 0.38), 320.0).clamp(180.0, 320.0);

        return SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: maxH),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _IllustrationHero(page: page, isDark: isDark, heroDim: dim),
                  const SizedBox(height: 28),
                  _TextBlock(page: page, isDark: isDark),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The slide's artwork.
///
/// ── WHAT CAME OFF IT ──────────────────────────────────────────────────────
/// A rounded card with a tinted fill, a 1.5pt accent border, a drop shadow, a
/// full-bleed gradient blob painted behind everything, a floating pill badge
/// in the top-left, and two Phosphor glyphs. Seven layers of chrome framing
/// an illustration that did not exist yet, because the glyphs were standing
/// in for one.
///
/// Now that there is real artwork, all of it is in the way — the same call
/// made on the splash and on both auth screens. An illustration is a picture;
/// a picture in a bordered card with a shadow is a picture of a card. The
/// gradient blob is the worst of them: it tinted the artwork's own whites and
/// shifted hue on every swipe, so the same drawing read as a different colour
/// on each slide.
///
/// ── SVG, NOT PNG ──────────────────────────────────────────────────────────
/// These are line illustrations at up to 1033pt wide, shown at roughly a
/// third of that on a handset and at full size on a tablet. A raster would
/// need three densities per slide and would still be soft on the next screen
/// size. They also already carry #047857 — the brand green — in the file, so
/// the artwork is on-palette without being recoloured at runtime.
class _IllustrationHero extends StatelessWidget {
  const _IllustrationHero({
    required this.page,
    required this.isDark,
    required this.heroDim,
  });

  final _OnboardPage page;
  final bool isDark;
  final double heroDim;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: heroDim,
      height: heroDim,
      child: Padding(
        // The drawings carry very little internal margin, and a line
        // illustration touching the edge of its box reads as cropped.
        padding: const EdgeInsets.all(8),
        child: SvgPicture.asset(
          page.art,
          // `contain`, so the three different aspect ratios (662x720,
          // 731x629, 1033x835) each sit inside the same square without one
          // of them being cropped or stretched to match the others.
          fit: BoxFit.contain,
          // Decorative: the heading and subtitle beneath carry the meaning,
          // and a screen reader announcing a description of the drawing as
          // well would say the slide twice.
          excludeFromSemantics: true,
          // Shown while the asset is decoded — a blank box of the right size,
          // so the slide does not reflow when it arrives.
          placeholderBuilder: (_) => const SizedBox.expand(),
        ),
      ),
    );
  }
}

class _TextBlock extends StatelessWidget {
  final _OnboardPage page;
  final bool isDark;

  const _TextBlock({required this.page, required this.isDark});

  @override
  Widget build(BuildContext context) {
    final textPrimary = AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Eyebrow
        Container(
          padding:
              const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: page.theme.indicatorColor.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(AppRadius.pill),
          ),
          child: Text(
            page.eyebrow,
            style: sfPro(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: page.theme.indicatorColor,
              letterSpacing: 1.2,
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          page.title,
          style: sfPro(
            fontSize: 26,
            fontWeight: FontWeight.w700,
            color: textPrimary,
            letterSpacing: -0.5,
            height: 1.2,
          ),
        ),
        const SizedBox(height: 14),
        Text(
          page.subtitle,
          style: sfPro(
            fontSize: 14,
            fontWeight: FontWeight.w400,
            color: textSecondary,
            height: 1.55,
          ),
        ),
      ],
    );
  }
}

// ── Blob background painter ────────────────────────────────────────────────────

/// The per-slide accent.
///
/// ── THIS CLASS IS A RECONSTRUCTION, AND THE ORIGINAL IS LOST ──────────────
/// It was deleted by accident on 2026-10-15 while removing the dead
/// `_BlobPainter` that sat immediately above it, and it had never been
/// committed, so there is no copy in git, in a worktree or in a `-lilo` twin.
/// What survives is its USAGE — four call sites, all of them `indicatorColor`
/// — and one comment on the CTA below recording that the accent differed per
/// page ("this took the CURRENT PAGE's accent at 38%, so the CTA's glow
/// changed hue as you swiped through onboarding").
///
/// So the SHAPE here is certain and the VALUES are not. The three were very
/// likely distinct — a green, a blue and a red would fit the names.
///
/// ── WHY THE REBUILD IS ONE COLOUR ─────────────────────────────────────────
/// Not laziness about the guess: picking three plausible-looking colours
/// would be inventing a palette and then presenting it as recovered, which is
/// worse than a flat one that is obviously a decision. And a single brand
/// accent is where everything else in this app has independently landed —
/// the CTA shadow on this very screen was neutralised because its hue
/// shifting per slide was judged wrong, the splash, both auth screens and the
/// three new illustrations are all #047857, and `AppColors.headerSurface`
/// documents "one green in the app, no exceptions".
///
/// If the original three were deliberate, this is the one place to put them
/// back: give each constant its own colour and nothing else has to change.
class _PageTheme {
  const _PageTheme({required this.indicatorColor});

  /// Drives the page dots, the CTA fill, and the eyebrow's wash and ink.
  final Color indicatorColor;

  static const security = _PageTheme(indicatorColor: AppColors.primaryDark);
  static const community = _PageTheme(indicatorColor: AppColors.primaryDark);
  static const emergency = _PageTheme(indicatorColor: AppColors.primaryDark);
}

class _OnboardPage {
  final _PageTheme theme;
  final String eyebrow;
  final String title;
  final String subtitle;
  /// The slide's illustration, as an SVG asset path.
  ///
  /// Replaces a `primaryIcon` / `accentIcon` / `badgeLabel` trio. Those
  /// described the slide three times over — a glyph for the subject, a second
  /// glyph for its qualifier, and a pill repeating both in words — above an
  /// eyebrow that was already saying it a fourth time.
  final String art;

  const _OnboardPage({
    required this.theme,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.art,
  });
}
