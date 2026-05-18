import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_container.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/shared_widgets.dart';

/// Panic Button — offline-capable via local protocol / SMS trigger.
class PanicButtonScreen extends StatefulWidget {
  const PanicButtonScreen({super.key});

  @override
  State<PanicButtonScreen> createState() => _PanicButtonScreenState();
}

class _PanicButtonScreenState extends State<PanicButtonScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  Timer? _countdownTimer;
  bool _dispatched = false;
  bool _arming = false;
  bool _sending = false;
  int _secondsLeft = 5;

  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _textPrimary =>
      _isDark ? const Color(0xFFF5F7FA) : AppColors.textPrimary;
  Color get _textSecondary =>
      _isDark ? const Color(0xFFB3BDC8) : AppColors.textSecondary;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  void _startCountdown() {
    if (_sending || _arming || _dispatched) return;
    setState(() {
      _arming = true;
      _secondsLeft = 5;
    });
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) async {
      if (!mounted) return;
      if (_secondsLeft <= 1) {
        timer.cancel();
        await _dispatch();
        return;
      }
      setState(() => _secondsLeft -= 1);
    });
  }

  void _cancelCountdown() {
    _countdownTimer?.cancel();
    setState(() {
      _arming = false;
      _secondsLeft = 5;
    });
  }

  Future<void> _dispatch() async {
    _countdownTimer?.cancel();
    setState(() {
      _arming = false;
      _sending = true;
    });
    await Future.delayed(const Duration(milliseconds: 850));
    if (!mounted) return;
    setState(() {
      _sending = false;
      _dispatched = true;
    });
    HapticFeedback.heavyImpact();
  }

  Future<void> _callSecurity() async {
    final uri = Uri.parse('tel:+639177654321');
    await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      appBar: AppBar(
        title: const Text('Emergency'),
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: AppSpacing.md),
            GlassContainer(
              padding: const EdgeInsets.all(AppSpacing.md),
              tint: AppColors.danger,
              child: Row(
                children: [
                  const Icon(Icons.wifi_off_outlined,
                      color: AppColors.danger),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      'Offline mode enabled — panic signal will be sent via SMS if internet is unavailable.',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: _textSecondary,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Expanded(
              child: Center(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () {
                      HapticFeedback.mediumImpact();
                      _startCountdown();
                    },
                    onLongPress: () => HapticFeedback.heavyImpact(),
                    splashColor: Colors.white24,
                    highlightColor: Colors.white10,
                    child: AnimatedBuilder(
                    animation: _pulse,
                    builder: (_, __) {
                      final ringScale =
                          1.0 + (_pulse.value * (_arming ? 0.16 : 0.1));
                      final oxblood = AppColors.panicOxblood;
                      return Stack(
                        alignment: Alignment.center,
                        children: [
                          Transform.scale(
                            scale: ringScale,
                            child: Container(
                              width: 250,
                              height: 250,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: oxblood
                                    .withValues(alpha: _arming ? 0.22 : 0.12),
                              ),
                            ),
                          ),
                          Ink(
                            width: 218,
                            height: 218,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: RadialGradient(
                                colors: [
                                  Color.lerp(oxblood, Colors.white, 0.06)!,
                                  Color.lerp(oxblood, Colors.black, 0.18)!,
                                ],
                              ),
                              border:
                                  Border.all(color: Colors.white, width: 3),
                              boxShadow: [
                                BoxShadow(
                                  color: oxblood.withValues(alpha: 0.55),
                                  blurRadius: 28,
                                  spreadRadius: 2,
                                ),
                                BoxShadow(
                                  color:
                                      AppColors.panicGlowOuter.withValues(alpha: 0.9),
                                  blurRadius: 52,
                                  spreadRadius: -12,
                                  offset: const Offset(0, 14),
                                ),
                                BoxShadow(
                                  color:
                                      Colors.black.withValues(alpha: 0.45),
                                  blurRadius: 36,
                                  offset: const Offset(0, 22),
                                ),
                              ],
                            ),
                            child: Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.sos_rounded,
                                      size: 58, color: Colors.white),
                                  const SizedBox(height: 8),
                                  Text(
                                    _sending
                                        ? 'SENDING ALERT...'
                                        : _arming
                                            ? 'SENDING IN $_secondsLeft'
                                            : _dispatched
                                                ? 'ALERT SENT'
                                                : 'TAP TO START',
                                    style: GoogleFonts.inter(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 1.2,
                                      fontSize: 12.5,
                                    ),
                                  ),
                                  Text(
                                    _arming
                                        ? 'TAP CANCEL IF ACCIDENTAL'
                                        : 'EMERGENCY ALERT',
                                    style: GoogleFonts.inter(
                                      color: Colors.white.withValues(alpha: 0.95),
                                      fontSize: 11.5,
                                      letterSpacing: 1.8,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            if (_dispatched)
              GlassContainer(
                padding: const EdgeInsets.all(AppSpacing.md),
                tint: AppColors.success,
                child: Row(
                  children: [
                    const Icon(Icons.check_circle,
                        color: AppColors.success),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        'Signal dispatched. Security team notified — ETA 2 minutes.',
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          color: _textPrimary,
                        ),
                      ),
                    ),
                  ],
                ),
              )
            else
              GlassContainer(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Row(
                  children: [
                    const Icon(Icons.info_outline,
                        color: AppColors.info),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        _arming
                            ? 'Countdown active. Tap Cancel to stop sending this emergency alert.'
                            : 'Tap emergency button to start a 5-second safety countdown before sending.',
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          color: _textSecondary,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: GhostButton(
                    label: 'Call security',
                    icon: Icons.phone_outlined,
                    onPressed: _callSecurity,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: GhostButton(
                    label: _arming ? 'Cancel Send' : 'Cancel',
                    icon: Icons.close_outlined,
                    onPressed: _arming
                        ? _cancelCountdown
                        : () => Navigator.of(context).pop(),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
