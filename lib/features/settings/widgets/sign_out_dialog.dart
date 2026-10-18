import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/blur_modal.dart';

/// Asks before ending the session. Resolves true only on "Log Out"; Cancel,
/// a tap on the backdrop and the system back gesture all resolve false.
///
/// Signing out was one tap on a row near the bottom of a scrolling list — easy
/// to hit on the way to the app version — and it drops the resident at the
/// login screen with their push token deleted.
Future<bool> confirmSignOut(BuildContext context) async {
  HapticFeedback.selectionClick();
  final reduceMotion = MediaQuery.disableAnimationsOf(context);
  final result = await showGeneralDialog<bool>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Dismiss',
    barrierColor: Colors.transparent, // the blur layer paints its own scrim
    transitionDuration: Duration(milliseconds: reduceMotion ? 0 : 220),
    pageBuilder: (context, _, __) => const SignOutDialog(),
    // Untouched on purpose. The backdrop and the card animate themselves off
    // the route — see the note in blur_modal.dart for why a fade around the
    // whole page made the blur snap in on the last frame.
    transitionBuilder: (context, animation, _, child) => child,
  );
  return result ?? false;
}

class SignOutDialog extends StatelessWidget {
  const SignOutDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: BlurModalBackdrop(
            onTap: () => Navigator.of(context).pop(false),
          ),
        ),
        Center(
          child: ModalCardEntrance(
            scaleFrom: 0.96,
            child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: Material(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(AppRadius.xl),
                clipBehavior: Clip.antiAlias,
                elevation: 0,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          color: AppColors.danger.withValues(alpha: 0.08),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(AppIcons.signOut,
                            color: AppColors.danger, size: 26),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        'Log out?',
                        textAlign: TextAlign.center,
                        style: sfPro(
                          fontSize: 19,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Are you sure you want to log out?',
                        textAlign: TextAlign.center,
                        style: sfPro(
                          fontSize: 14.5,
                          height: 1.45,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 24),
                      Row(
                        children: [
                          Expanded(
                            child: _DialogButton(
                              label: 'Cancel',
                              filled: false,
                              onPressed: () => Navigator.of(context).pop(false),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _DialogButton(
                              label: 'Log Out',
                              filled: true,
                              onPressed: () => Navigator.of(context).pop(true),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          ),
        ),
      ],
    );
  }
}

class _DialogButton extends StatelessWidget {
  const _DialogButton({
    required this.label,
    required this.filled,
    required this.onPressed,
  });

  final String label;
  final bool filled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(999),
    );
    final text = Text(
      label,
      style: sfPro(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: filled ? Colors.white : AppColors.textPrimary,
      ),
    );
    return SizedBox(
      height: 48,
      child: filled
          ? FilledButton(
              onPressed: onPressed,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.danger,
                shape: shape,
                elevation: 0,
              ),
              child: text,
            )
          : OutlinedButton(
              onPressed: onPressed,
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.borderNeutral),
                shape: shape,
              ),
              child: text,
            ),
    );
  }
}
