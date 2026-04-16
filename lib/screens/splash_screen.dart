import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/glass_container.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _fade;

  @override
  void initState() {
    super.initState();
    _fade = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..forward();

    Future.delayed(const Duration(milliseconds: 1800), () {
      if (mounted) Navigator.of(context).pushReplacementNamed('/login');
    });
  }

  @override
  void dispose() {
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      body: FadeTransition(
        opacity: _fade,
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              GlassContainer(
                width: 112,
                height: 112,
                borderRadius: AppRadius.xl,
                padding: EdgeInsets.zero,
                variant: GlassVariant.elevated,
                child: const Center(
                  child: Icon(
                    Icons.shield_moon_outlined,
                    color: AppColors.accent,
                    size: 54,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text('Monticello Villas', style: AppText.headline),
              const SizedBox(height: 6),
              Text(
                'SECURE • VERIFIED • CONNECTED',
                style: AppText.overline.copyWith(
                  color: AppColors.textSecondary,
                ),
              ),
              const Spacer(),
              const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  color: AppColors.accent,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Initializing secure session…',
                style: AppText.caption,
              ),
              const SizedBox(height: AppSpacing.xl),
              Text(
                'v1.0.0  •  Resident App',
                style: GoogleFonts.inter(
                  fontSize: 10.5,
                  color: AppColors.textMuted,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
            ],
          ),
        ),
      ),
    );
  }
}
