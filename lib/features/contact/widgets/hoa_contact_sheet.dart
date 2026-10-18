import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// Where the HOA can be reached.
///
/// ── REAL NUMBERS, FINALLY ─────────────────────────────────────────────────
/// These were placeholders — `+63 917 123 4567` and `+63 917 765 4321`, the
/// kind of number that looks plausible enough to ship and reaches nobody. On
/// a safety app the contact sheet is the screen a resident opens when
/// something is wrong, so a fake number here is worse than an empty list: an
/// empty list sends them to find a real one.
///
/// Deliberately in one place. They used to be literals buried in a bottom
/// sheet inside the Settings screen, which is not somewhere anyone thinks to
/// look when a guard changes.
class HoaContact {
  HoaContact._();

  /// Written the way residents write them — local `09XX` mobile format,
  /// grouped 4-3-4 so they can be read aloud. [dialUri] strips the spacing for
  /// the dialler.
  static const String officeNumber = '0966 241 7617';

  /// The `tel:` URI for a number as displayed: digits (and a leading +) only.
  static Uri dialUri(String number) =>
      Uri(scheme: 'tel', path: number.replaceAll(RegExp(r'[^\d+]'), ''));

  /// "HOA Admin Office", the office's name in the directory.
  static const String officeName = 'HOA Admin Office';
  static const String mainGateNumber = '0951 280 1347';

  /// The guards on the roster, in the order the office gave them.
  ///
  /// A list rather than four more constants: the roster changes, and the
  /// sheet should grow and shrink with it instead of needing a new tile
  /// hand-written for each arrival.
  static const List<({String name, String number})> guards = [
    (name: 'Jonathan Marbebe', number: '0945 382 3579'),
    (name: 'Jose Sollano', number: '0907 897 0640'),
    (name: 'Wheve Oro', number: '0938 155 0006'),
  ];
  static const String officeEmail = 'hoa@monticellovillas.local';
  static const String facebookPage =
      'https://www.facebook.com/monticellovillas';
  static const String officeLocation =
      'Monticello Villas Main Office, Phase 1 Clubhouse';
  static const String officeHours = 'Mon-Sat, 8:00 AM - 5:00 PM';
}

/// Opens the "Contact HOA Office" sheet.
///
/// Lifted out of the old `settings_screen.dart` (since deleted), where it was a private method on that
/// screen's State and therefore reachable only from Settings. The bottom nav's
/// Contact tab needs the same sheet, and a second copy of a phone number is a
/// second phone number to get wrong.
Future<void> showHoaContactSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.backgroundSecondary,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
      side: BorderSide(color: AppColors.divider),
    ),
    builder: (sheetContext) => const _HoaContactSheet(),
  );
}

class _HoaContactSheet extends StatelessWidget {
  const _HoaContactSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(18, 14, 18, 22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.divider,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text('Contact HOA Office',
                style: _t(size: 17, weight: FontWeight.w700)),
            const SizedBox(height: 14),
            _ContactTile(
              icon: PhosphorIconsBold.buildingApartment,
              title: HoaContact.officeName,
              subtitle: HoaContact.officeNumber,
              onTap: () => _showPhoneActions(
                context,
                title: HoaContact.officeName,
                number: HoaContact.officeNumber,
              ),
            ),
            const _DividerLine(),
            _ContactTile(
              icon: PhosphorIconsBold.shieldCheck,
              title: 'Main gate guard',
              subtitle: HoaContact.mainGateNumber,
              onTap: () => _showPhoneActions(
                context,
                title: 'Main gate guard',
                number: HoaContact.mainGateNumber,
              ),
            ),
            // The roster, rendered from the list rather than hand-written —
            // see the note on HoaContact.guards. The gate comes first because
            // it is the number that is always staffed; the named guards are
            // who you ask for after that.
            for (final guard in HoaContact.guards) ...[
              const _DividerLine(),
              _ContactTile(
                icon: PhosphorIconsBold.shieldCheck,
                title: guard.name,
                subtitle: guard.number,
                onTap: () => _showPhoneActions(
                  context,
                  title: guard.name,
                  number: guard.number,
                ),
              ),
            ],
            const _DividerLine(),
            _ContactTile(
              icon: PhosphorIconsBold.envelopeSimple,
              title: 'Email',
              subtitle: HoaContact.officeEmail,
              onTap: () => _openUrl(context, 'mailto:${HoaContact.officeEmail}'),
              trailing: TextButton(
                onPressed: () =>
                    _copyText(context, 'Email', HoaContact.officeEmail),
                child: Text('Copy',
                    style: _t(
                        size: 12.5,
                        weight: FontWeight.w600,
                        color: AppColors.primary)),
              ),
            ),
            const _DividerLine(),
            _ContactTile(
              icon: PhosphorIconsBold.facebookLogo,
              title: 'Facebook page',
              subtitle: 'Monticello Villas',
              onTap: () => _openUrl(context, HoaContact.facebookPage),
            ),
            const SizedBox(height: 14),
            const _Meta(
                label: 'Office location', value: HoaContact.officeLocation),
            const SizedBox(height: 10),
            const _Meta(label: 'Office hours', value: HoaContact.officeHours),
          ],
        ),
      ),
    );
  }
}

Future<void> _showPhoneActions(
  BuildContext context, {
  required String title,
  required String number,
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.backgroundSecondary,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      side: BorderSide(color: AppColors.divider),
    ),
    builder: (sheetContext) => SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: _t(size: 16, weight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(number, style: _t(size: 13, color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(PhosphorIconsBold.phoneCall,
                  color: AppColors.primary),
              title: Text('Call now', style: _t(size: 14.5)),
              onTap: () async {
                final navigator = Navigator.of(sheetContext);
                final host = context;
                navigator.pop();
                await _openUrl(host, HoaContact.dialUri(number).toString());
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading:
                  const Icon(PhosphorIconsBold.copy, color: AppColors.primary),
              title: Text('Copy number', style: _t(size: 14.5)),
              onTap: () async {
                final navigator = Navigator.of(sheetContext);
                final host = context;
                navigator.pop();
                await _copyText(host, 'Phone number', number);
              },
            ),
          ],
        ),
      ),
    ),
  );
}

Future<void> _openUrl(BuildContext context, String rawUrl) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  try {
    final ok = await launchUrl(Uri.parse(rawUrl));
    if (!ok) _toast(messenger, 'Unable to open link.');
  } catch (_) {
    // A missing handler (no dialler, no mail client) is a normal device state,
    // not an error worth a stack trace — the number is still on screen to copy.
    _toast(messenger, 'Unable to open link.');
  }
}

Future<void> _copyText(
    BuildContext context, String label, String value) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  await Clipboard.setData(ClipboardData(text: value));
  _toast(messenger, '$label copied.');
}

void _toast(ScaffoldMessengerState? messenger, String message) {
  if (messenger == null) return;
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      content: Text(message, style: _t(size: 13.5, color: AppColors.textPrimary)),
      backgroundColor: AppColors.backgroundElevated,
      behavior: SnackBarBehavior.floating,
    ),
  );
}

class _ContactTile extends StatelessWidget {
  const _ContactTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(AppRadius.xs),
        ),
        child: Icon(icon, size: 18, color: AppColors.primary),
      ),
      title: Text(title, style: _t(size: 14.5, weight: FontWeight.w600)),
      subtitle:
          Text(subtitle, style: _t(size: 12.5, color: AppColors.textSecondary)),
      trailing: trailing ??
          const Icon(AppIcons.chevronRight,
              color: AppColors.textMuted, size: 20),
      onTap: onTap,
    );
  }
}

class _DividerLine extends StatelessWidget {
  const _DividerLine();

  @override
  Widget build(BuildContext context) =>
      const Divider(height: 1, thickness: 1, color: AppColors.divider);
}

class _Meta extends StatelessWidget {
  const _Meta({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: _t(
                size: 12, weight: FontWeight.w700, color: AppColors.textMuted)),
        const SizedBox(height: 4),
        Text(value,
            style: _t(
                size: 14,
                color: AppColors.textPrimary,
                weight: FontWeight.w500)),
      ],
    );
  }
}

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
}) {
  return sfPro(fontSize: size, fontWeight: weight, color: color);
}
