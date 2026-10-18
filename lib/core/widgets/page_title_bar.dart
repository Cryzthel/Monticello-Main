import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';

/// THE secondary-screen header: a back button, a centred title, and optionally
/// one trailing action.
///
/// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
/// Nine screens hand-rolled this same 44px `Stack` with a `centerLeft` back
/// button and a centred `Text`, each supplying its own type style from its own
/// private `_t()` / `_sf()` helper. They had already drifted: Settings,
/// History, Edit Profile, Property Details and Change Password set the title at
/// w700, while Announcements and Notifications set it at w800 — visibly heavier
/// on two screens out of seven, for no reason anyone chose.
///
/// One widget makes "every page title matches" structural instead of a thing
/// seven files happen to agree on. [titleStyle] below is the single definition.
///
/// ── WHY EQUAL SPACERS RATHER THAN A STACK ─────────────────────────────────
/// A `Stack` centres the title against the FULL width, which is correct — but
/// it also lets a long title run underneath the back button, because the two
/// are layered rather than laid out. A `Row` with a fixed-width box on each
/// side reserves the room instead: the title gets the space between them and
/// ellipsizes at that boundary, so it stays centred AND can never collide.
///
/// The spacers are [ModernBackButton]'s own 44px tap target, not an arbitrary
/// figure — which is what keeps the title optically centred whether or not a
/// trailing action is present, since both sides always reserve the same width.
class PageTitleBar extends StatelessWidget {
  const PageTitleBar({
    super.key,
    required this.title,
    this.onBack,
    this.onNothingToPop,
    this.trailing,
    this.showBack = true,
  });

  final String title;

  /// Overrides the default pop.
  final VoidCallback? onBack;

  /// What "back" means when this screen is a TAB rather than a pushed route —
  /// History is mounted both ways. See [ModernBackButton].
  final VoidCallback? onNothingToPop;

  /// One optional action, right-aligned. Sized into the same 44px box as the
  /// back button so adding one does not shift the title.
  final Widget? trailing;

  final bool showBack;

  /// The 44px tap target [ModernBackButton] reserves around its 40px disc.
  static const double _slot = 44;

  /// The app's page-title style. 18px / w700 / -0.3 — the value five of the
  /// seven screens already used, so adopting this moves two screens rather
  /// than five.
  static TextStyle get titleStyle => sfPro(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
        letterSpacing: -0.3,
        height: 1.25,
      );

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: SizedBox(
        height: _slot,
        child: Row(
          children: [
            SizedBox(
              width: _slot,
              // `Align`, so a back button narrower than the slot still sits
              // flush to the leading edge rather than centred inside it.
              child: showBack
                  ? Align(
                      alignment: Alignment.centerLeft,
                      child: ModernBackButton(
                        onPressed: onBack,
                        onNothingToPop: onNothingToPop,
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: Text(
                title,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: titleStyle,
              ),
            ),
            SizedBox(
              width: _slot,
              child: trailing == null
                  ? null
                  : Align(
                      alignment: Alignment.centerRight,
                      child: trailing,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
