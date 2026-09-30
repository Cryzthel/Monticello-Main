import 'dart:math' show min;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_theme.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

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
      primaryIcon: Icons.shield_rounded,
      accentIcon: Icons.location_on_rounded,
      badgeLabel: 'Live Reporting',
    ),
    _OnboardPage(
      theme: _PageTheme.community,
      eyebrow: 'COMMUNITY UPDATES',
      title: 'Never miss an\nannouncement.',
      subtitle:
          'Official HOA circulars, village alerts, and administrative notices delivered instantly to your device—always organized, never lost.',
      primaryIcon: Icons.campaign_rounded,
      accentIcon: Icons.notifications_active_rounded,
      badgeLabel: 'Instant Alerts',
    ),
    _OnboardPage(
      theme: _PageTheme.emergency,
      eyebrow: 'OFFLINE FAILOVER',
      title: 'Emergency help,\neven offline.',
      subtitle:
          'The Panic Button works without internet. One tap deploys an automated SMS emergency protocol directly to village guards.',
      primaryIcon: Icons.sos_rounded,
      accentIcon: Icons.wifi_off_rounded,
      badgeLabel: 'Panic Button',
    ),
  ];

  bool get _isLast => _index == _pages.length - 1;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await OnboardingScreen.markSeen();
    if (!mounted) return;
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
    final bg = isDark ? AppColors.midnightBase : const Color(0xFFF8F9FA);

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
                  Row(
                    children: [
                      Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.shield_rounded,
                            color: Colors.white, size: 16),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        'Monticello Villas',
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: isDark ? Colors.white : AppColors.textPrimary,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
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
                        style: GoogleFonts.inter(
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
                              : (isDark
                                  ? AppColors.midnightSurfaceElevated
                                  : const Color(0xFFE2E5EB)),
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
                        boxShadow: [
                          BoxShadow(
                            color: _pages[_index]
                                .theme
                                .indicatorColor
                                .withOpacity(0.38),
                            blurRadius: 24,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: ElevatedButton(
                        onPressed: _next,
                        style: ElevatedButton.styleFrom(
                          backgroundColor:
                              _pages[_index].theme.indicatorColor,
                          foregroundColor: Colors.white,
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
                            style: GoogleFonts.inter(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
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

class _IllustrationHero extends StatelessWidget {
  final _OnboardPage page;
  final bool isDark;
  final double heroDim;

  const _IllustrationHero({
    required this.page,
    required this.isDark,
    required this.heroDim,
  });

  @override
  Widget build(BuildContext context) {
    final dim = heroDim;
    final theme = page.theme;
    final cardBg = isDark
        ? Color.lerp(AppColors.midnightSurface, theme.gradientEnd, 0.12)!
        : Color.lerp(Colors.white, theme.gradientEnd, 0.06)!;
    final borderColor = isDark
        ? theme.indicatorColor.withOpacity(0.22)
        : theme.indicatorColor.withOpacity(0.15);

    return Container(
      width: dim,
      height: dim,
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        border: Border.all(color: borderColor, width: 1.5),
        boxShadow: [
          BoxShadow(
            color: theme.indicatorColor.withOpacity(isDark ? 0.18 : 0.10),
            blurRadius: 48,
            spreadRadius: -8,
            offset: const Offset(0, 16),
          ),
          BoxShadow(
            color: Colors.black.withOpacity(isDark ? 0.35 : 0.06),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Stack(
        children: [
          // Gradient blob background
          Positioned.fill(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.xl - 2),
              child: CustomPaint(
                painter: _BlobPainter(
                  color: theme.indicatorColor,
                  isDark: isDark,
                ),
              ),
            ),
          ),

          // Badge top-left
          Positioned(
            top: 20,
            left: 20,
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: isDark
                    ? AppColors.midnightSurface.withOpacity(0.85)
                    : Colors.white.withOpacity(0.92),
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(
                    color: theme.indicatorColor.withOpacity(0.30)),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.12),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(page.accentIcon,
                      size: 12, color: theme.indicatorColor),
                  const SizedBox(width: 6),
                  Text(
                    page.badgeLabel,
                    style: GoogleFonts.inter(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: theme.indicatorColor,
                      letterSpacing: 0.3,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Central icon
          Center(
            child: Container(
              width: dim * 0.40,
              height: dim * 0.40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: theme.indicatorColor.withOpacity(isDark ? 0.22 : 0.14),
                border: Border.all(
                    color: theme.indicatorColor.withOpacity(0.35), width: 2),
              ),
              child: Icon(
                page.primaryIcon,
                size: dim * 0.22,
                color: theme.indicatorColor,
              ),
            ),
          ),

          // Status ring decoration bottom-right
          Positioned(
            bottom: 22,
            right: 22,
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isDark
                    ? AppColors.midnightSurface.withOpacity(0.85)
                    : Colors.white.withOpacity(0.92),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.14),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Icon(
                Icons.check_rounded,
                size: 22,
                color: theme.indicatorColor,
              ),
            ),
          ),
        ],
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
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
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
            color: page.theme.indicatorColor.withOpacity(0.10),
            borderRadius: BorderRadius.circular(AppRadius.pill),
          ),
          child: Text(
            page.eyebrow,
            style: GoogleFonts.inter(
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
          style: GoogleFonts.inter(
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
          style: GoogleFonts.inter(
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

class _BlobPainter extends CustomPainter {
  final Color color;
  final bool isDark;
  const _BlobPainter({required this.color, required this.isDark});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withOpacity(isDark ? 0.09 : 0.06)
      ..style = PaintingStyle.fill;

    final path = Path()
      ..moveTo(size.width * 0.8, 0)
      ..quadraticBezierTo(
          size.width, size.height * 0.3, size.width * 0.9, size.height * 0.6)
      ..quadraticBezierTo(
          size.width * 0.7, size.height, size.width * 0.4, size.height * 0.85)
      ..quadraticBezierTo(0, size.height * 0.7, 0, size.height * 0.4)
      ..quadraticBezierTo(0, 0, size.width * 0.8, 0)
      ..close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_BlobPainter old) =>
      old.color != color || old.isDark != isDark;
}

// ── Data models ───────────────────────────────────────────────────────────────

enum _PageTheme {
  security,
  community,
  emergency;

  Color get indicatorColor {
    switch (this) {
      case _PageTheme.security:
        return AppColors.primary; // Deep Maroon
      case _PageTheme.community:
        return AppColors.ctaGreen; // Emerald Green
      case _PageTheme.emergency:
        return const Color(0xFFDC2626); // Emergency Red
    }
  }

  Color get gradientEnd {
    switch (this) {
      case _PageTheme.security:
        return AppColors.primary;
      case _PageTheme.community:
        return AppColors.ctaGreen;
      case _PageTheme.emergency:
        return const Color(0xFFDC2626);
    }
  }
}

class _OnboardPage {
  final _PageTheme theme;
  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData primaryIcon;
  final IconData accentIcon;
  final String badgeLabel;

  const _OnboardPage({
    required this.theme,
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.primaryIcon,
    required this.accentIcon,
    required this.badgeLabel,
  });
}
