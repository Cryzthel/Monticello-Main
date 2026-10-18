import 'package:flutter/material.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/core/widgets/staged_progress.dart';

/// The app's standard CTA submit button — used identically everywhere a
/// form's final action needs the 3-stage loading sequence: pending
/// percentage -> drawn checkmark -> caller-driven finalize (navigate away,
/// reveal a success sheet, etc).
///
/// Pass a [controller] and drive it with real step-completion percentages
/// while [busy] is true to get the full staged sequence; omit it (or leave
/// [busy] false while idle) and the button behaves like a plain CTA with a
/// simple spinner fallback.
///
/// Fixed at [height] (54, the app's standard button height) with a percent
/// scale tuned to sit comfortably inside it — the confirmation checkmark
/// badge works out to ~32px, leaving balanced padding on every side so it
/// never reads as oversized or cramped.
class StagedSubmitButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool busy;
  final StagedProgressController? controller;
  final Color color;

  /// Corner radius. Defaults to the app's standard control corner.
  ///
  /// Overridable for ONE caller: the sign-up flow, whose buttons are capsules
  /// because the authentication screens mirror the web portals' sign-in,
  /// where the primary action is `rounded-full`. Everywhere else — report
  /// submit, deletion confirm — keeps [AppRadius.sm], because the rest of the
  /// app is not the threshold. See AuthTokens in
  /// lib/features/auth/widgets/auth_controls.dart.
  final double borderRadius;

  /// Overridable for the same reason as [borderRadius]: the auth capsule is
  /// 48pt (`h-12`), and a 54pt button beside a 48pt field is the kind of
  /// two-pixel-off that makes a form look assembled rather than designed.
  final double? heightOverride;

  static const double height = 54;
  static const double _percentFontSize = 18;

  const StagedSubmitButton({
    super.key,
    required this.label,
    this.icon,
    required this.onPressed,
    this.busy = false,
    this.controller,
    this.color = AppColors.accentPrimary,
    this.borderRadius = AppRadius.sm,
    this.heightOverride,
  });

  @override
  Widget build(BuildContext context) {
    const foreground = AppColors.background;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
        // Neutral. This took the BUTTON'S OWN colour at 35%, so it glowed
        // emerald on a submit and red on a destructive action — a shadow that
        // changed hue with the semantics of the thing casting it. Depth is
        // grey; the fill already carries the meaning.
        boxShadow: onPressed != null && !busy ? AppShadows.md : const [],
      ),
      child: SizedBox(
        width: double.infinity,
        height: heightOverride ?? height,
        child: ElevatedButton(
          onPressed: busy ? null : withKeyboardDismissed(onPressed),
          style: ElevatedButton.styleFrom(
            backgroundColor: color,
            // ── BUSY IS NOT DISABLED ─────────────────────────────────────
            // Both reach ElevatedButton as `onPressed: null`, so both used to
            // paint the same 38% wash — a submission in progress looked like
            // a form not yet filled in. Busy now keeps the full fill under
            // its spinner; only a button that cannot be pressed yet fades,
            // and it fades to the same 60% AuthButton uses, so every primary
            // action in the app has one disabled look.
            disabledBackgroundColor:
                busy ? color : color.withValues(alpha: 0.6),
            disabledForegroundColor: foreground,
            foregroundColor: foreground,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(borderRadius),
            ),
          ),
          child: !busy
              ? Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 18, color: foreground),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      label,
                      style: sfPro(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: foreground),
                    ),
                  ],
                )
              : (controller != null
                  ? StagedProgressView(
                      controller: controller!,
                      color: foreground,
                      percentFontSize: _percentFontSize,
                      // ── THE SAME LEAF AS EVERY OTHER BUTTON ──────────────
                      // This was a leaf riding a progress line. Every other
                      // primary action in the app — Sign In, Send Code,
                      // Verify Code, Reset Password, Save — shows the
                      // spinning [LeafLoader], so Create Account was the one
                      // button that waited differently. It spins now too.
                      // The percentages still drive the stages underneath;
                      // the checkmark at 100 is the finish, not a loader.
                      pendingBuilder: (_) =>
                          const LeafLoader(size: 20, color: foreground),
                      child: const Icon(PhosphorIconsFill.check,
                          color: foreground, size: 22),
                    )
                  : const LeafLoader(size: 20, color: foreground)),
        ),
      ),
    );
  }
}
