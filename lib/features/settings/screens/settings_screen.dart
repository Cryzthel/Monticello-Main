import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/theme_mode_controller.dart';
import '../services/user_profile_service.dart';
import '../theme/app_theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _textPrimary =>
      _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _textSecondary =>
      _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  Color get _textMuted =>
      _isDark ? AppColors.textMutedOnDark : AppColors.textMuted;
  Color get _bg => _isDark ? AppColors.midnightBase : AppColors.bgLight;
  Color get _card => _isDark ? AppColors.midnightSurface : AppColors.surfaceLight;
  Color get _cardSoft => _isDark ? AppColors.midnightSurfaceElevated : AppColors.surfaceLight;
  Color get _divider =>
      _isDark ? const Color(0xFF21262D) : AppColors.divider;
  Color get _brandColor => _isDark ? AppColors.primaryLight : AppColors.primary;

  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  Future<void> _hydrate() async {
    final svc = UserProfileService.instance;
    if (svc.profile == null) {
      await svc.load();
    }
    if (!mounted) return;
    setState(() => _initialized = true);
  }

  TextStyle _sf({
    double size = 15,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double letterSpacing = 0,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color ?? _textPrimary,
      letterSpacing: letterSpacing,
    );
  }

  void _showToast(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isError ? AppColors.danger : _brandColor,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        duration: const Duration(seconds: 2),
        content: Text(
          message,
          style: _sf(size: 14, weight: FontWeight.w500, color: Colors.white),
        ),
      ),
    );
  }

  Future<void> _signOut() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        title: Text('Sign out?', style: _sf(size: 17, weight: FontWeight.w600)),
        content: Text(
          'You will need to sign in again to access your account.',
          style: _sf(size: 14, color: _textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('Cancel',
                style: _sf(
                    size: 14, weight: FontWeight.w600, color: _textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('Sign out',
                style: _sf(size: 14, weight: FontWeight.w600, color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await FirebaseAuth.instance.signOut();
    } catch (_) {}
    await ThemeModeController.instance.loadGuest();
    UserProfileService.instance.clear();
    if (!mounted) return;
    Navigator.of(context).pushNamedAndRemoveUntil('/login', (_) => false);
  }

  Future<void> _openUrl(String rawUrl) async {
    final uri = Uri.parse(rawUrl);
    try {
      final ok = await launchUrl(uri);
      if (!ok && mounted) {
        _showToast('Unable to open link.', isError: true);
      }
    } catch (_) {
      if (mounted) _showToast('Unable to open link.', isError: true);
    }
  }

  Future<void> _copyText(String label, String value) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    _showToast('$label copied.');
  }

  Future<void> _showPhoneActions({
    required String title,
    required String number,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: _card,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
        side: BorderSide(color: _divider),
      ),
      builder: (ctx) {
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: _sf(size: 16, weight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(number, style: _sf(size: 13, color: _textSecondary)),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.call_outlined, color: _brandColor),
                  title: Text('Call now', style: _sf(size: 14.5)),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    await _openUrl('tel:$number');
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.copy_outlined, color: _brandColor),
                  title: Text('Copy number', style: _sf(size: 14.5)),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    await _copyText('Phone number', number);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showHoaContactSheet() async {
    const officeNumber = '+63 917 123 4567';
    const hotlineNumber = '+63 917 765 4321';
    const officeEmail = 'hoa@monticellovillas.local';
    const fbPage = 'https://www.facebook.com/monticellovillas';
    const officeLocation = 'Monticello Villas Main Office, Phase 1 Clubhouse';
    const officeHours = 'Mon-Sat, 8:00 AM - 5:00 PM';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: _card,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        side: BorderSide(color: _divider),
      ),
      builder: (ctx) {
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
                      color: _divider,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Text('Contact HOA Office',
                    style: _sf(size: 17, weight: FontWeight.w700)),
                const SizedBox(height: 14),
                _contactTile(
                  icon: Icons.apartment_rounded,
                  title: 'Main office',
                  subtitle: officeNumber,
                  onTap: () => _showPhoneActions(
                    title: 'Main office',
                    number: officeNumber,
                  ),
                ),
                _divLine(),
                _contactTile(
                  icon: Icons.shield_outlined,
                  title: 'Security hotline',
                  subtitle: hotlineNumber,
                  onTap: () => _showPhoneActions(
                    title: 'Security hotline',
                    number: hotlineNumber,
                  ),
                ),
                _divLine(),
                _contactTile(
                  icon: Icons.email_outlined,
                  title: 'Email',
                  subtitle: officeEmail,
                  onTap: () => _openUrl('mailto:$officeEmail'),
                  trailing: TextButton(
                    onPressed: () => _copyText('Email', officeEmail),
                    child: Text('Copy',
                        style: _sf(
                            size: 12.5,
                            weight: FontWeight.w600,
                            color: _brandColor)),
                  ),
                ),
                _divLine(),
                _contactTile(
                  icon: Icons.facebook_rounded,
                  title: 'Facebook page',
                  subtitle: 'Monticello Villas',
                  onTap: () => _openUrl(fbPage),
                ),
                const SizedBox(height: 14),
                Text('Office location',
                    style: _sf(
                        size: 12, weight: FontWeight.w700, color: _textMuted)),
                const SizedBox(height: 4),
                Text(officeLocation,
                    style: _sf(
                        size: 14,
                        color: _textPrimary,
                        weight: FontWeight.w500)),
                const SizedBox(height: 10),
                Text('Office hours',
                    style: _sf(
                        size: 12, weight: FontWeight.w700, color: _textMuted)),
                const SizedBox(height: 4),
                Text(officeHours,
                    style: _sf(
                        size: 14,
                        color: _textPrimary,
                        weight: FontWeight.w500)),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showAbout() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: _card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: _divider),
        ),
        title: Text(
          'About Monticello Villas',
          style: _sf(size: 17, weight: FontWeight.w700),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('v1.0.0', style: _sf(size: 12.5, color: _textMuted)),
            const SizedBox(height: 10),
            Text(
              'Resident app for community alerts, incidents, and announcements.',
              style: _sf(size: 13.5, color: _textSecondary),
            ),
            const SizedBox(height: 8),
            Text(
              '© Monticello Villas HOA',
              style: _sf(size: 12.5, color: _textMuted),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Close',
                style:
                    _sf(size: 13.5, weight: FontWeight.w600, color: _brandColor)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(
          [UserProfileService.instance, ThemeModeController.instance]),
      builder: (context, _) => Scaffold(
        backgroundColor: _bg,
        appBar: AppBar(
          backgroundColor: _bg,
          elevation: 0,
          scrolledUnderElevation: 0,
          leading: IconButton(
            icon: Icon(
              Icons.arrow_back_ios_new_rounded,
              color: _textPrimary,
              size: 18,
            ),
            onPressed: () => Navigator.of(context).maybePop(),
          ),
          centerTitle: true,
          title: Text(
            'Settings',
            style: _sf(size: 16, weight: FontWeight.w600, color: _textPrimary),
          ),
        ),
        body: !_initialized
            ? Center(child: CircularProgressIndicator(color: _brandColor))
            : Builder(
                builder: (context) {
                  final profile = UserProfileService.instance.profile;
                  if (profile == null) {
                    return Center(
                      child: Text(
                        'Sign in to access settings',
                        style: _sf(size: 14, color: _textSecondary),
                      ),
                    );
                  }
                  return ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                    children: [
                      _profileCard(profile),
                      const SizedBox(height: 24),
                      _sectionLabel('ACCOUNT'),
                      _group(children: [
                        _navTile(
                          icon: Icons.location_on_outlined,
                          label: 'Property details',
                          onTap: () => Navigator.of(context)
                              .pushNamed('/property-details'),
                        ),
                        _divLine(),
                        _navTile(
                          icon: Icons.lock_outline_rounded,
                          label: 'Change password',
                          onTap: () => Navigator.of(context)
                              .pushNamed('/change-password'),
                        ),
                      ]),
                      const SizedBox(height: 24),
                      _sectionLabel('APPEARANCE'),
                      _group(children: [
                        _switchTile(
                          icon: Icons.dark_mode_rounded,
                          label: 'Dark mode',
                          value: ThemeModeController.instance.isDark,
                          onChanged: (v) =>
                              ThemeModeController.instance.setDarkMode(v),
                        ),
                      ]),
                      const SizedBox(height: 24),
                      _sectionLabel('NOTIFICATIONS'),
                      _group(children: [
                        _switchTile(
                          icon: Icons.notifications_active_outlined,
                          label: 'Push notifications',
                          value: profile.notificationsEnabled,
                          onChanged: (v) => UserProfileService.instance
                              .updateField(notificationsEnabled: v),
                        ),
                        _divLine(),
                        _switchTile(
                          icon: Icons.alternate_email_rounded,
                          label: 'Email alerts',
                          value: profile.emailAlertsEnabled,
                          onChanged: (v) => UserProfileService.instance
                              .updateField(emailAlertsEnabled: v),
                        ),
                        _divLine(),
                        _switchTile(
                          icon: Icons.volume_up_outlined,
                          label: 'Sound for alerts',
                          value: profile.soundAlertsEnabled,
                          onChanged: (v) => UserProfileService.instance
                              .updateField(soundAlertsEnabled: v),
                        ),
                      ]),
                      _sectionLabel('SUPPORT'),
                      _group(children: [
                        _navTile(
                          icon: Icons.support_agent_rounded,
                          label: 'Contact HOA office',
                          onTap: _showHoaContactSheet,
                        ),
                        _divLine(),
                        _navTile(
                          icon: Icons.info_outline_rounded,
                          label: 'About Monticello Villas',
                          onTap: _showAbout,
                        ),
                      ]),
                      const SizedBox(height: 24),
                      _group(children: [
                        _navTile(
                          icon: Icons.logout_rounded,
                          label: 'Sign out',
                          labelColor: AppColors.danger,
                          iconColor: AppColors.danger,
                          onTap: _signOut,
                          showChevron: false,
                        ),
                      ]),
                      const SizedBox(height: 24),
                      Center(
                        child: Text(
                          'Monticello Villas • v1.0.0',
                          style: _sf(size: 11.5, color: _textMuted),
                        ),
                      ),
                    ],
                  );
                },
              ),
      ),
    );
  }

  Widget _profileCard(UserProfile profile) {
    final initials = profile.name.isNotEmpty
        ? profile.name.trim().substring(0, 1).toUpperCase()
        : (profile.email.isNotEmpty
            ? profile.email.substring(0, 1).toUpperCase()
            : 'M');
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _brandColor.withValues(alpha: 0.08),
              border: Border.all(
                color: _brandColor.withValues(alpha: 0.18),
                width: 1.2,
              ),
            ),
            child: Center(
              child: Text(
                initials,
                style: _sf(
                  size: 22,
                  weight: FontWeight.w700,
                  color: _brandColor,
                ),
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.name.isNotEmpty ? profile.name : 'Resident',
                  style: _sf(size: 16, weight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  profile.email.isNotEmpty ? profile.email : 'No email on file',
                  style: _sf(size: 12.5, color: _textSecondary),
                ),
                if (profile.bio.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    profile.bio,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: _sf(size: 12, color: _textMuted),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox.shrink(),
        ],
      ),
    );
  }

  Widget _sectionLabel(String label) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Text(
        label,
        style: _sf(
          size: 11.5,
          weight: FontWeight.w600,
          color: _textMuted,
          letterSpacing: 0.6,
        ),
      ),
    );
  }

  Widget _group({required List<Widget> children}) {
    return Container(
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(children: children),
    );
  }

  Widget _divLine() => Padding(
        padding: const EdgeInsets.only(left: 56),
        child: Divider(height: 1, thickness: 0.5, color: _divider),
      );

  Widget _navTile({
    required IconData icon,
    required String label,
    VoidCallback? onTap,
    Color? labelColor,
    Color? iconColor,
    bool showChevron = true,
  }) {
    final resolvedLabelColor = labelColor ?? _textPrimary;
    final resolvedIconColor = iconColor ?? _textPrimary;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: resolvedIconColor.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, size: 18, color: resolvedIconColor),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: _sf(
                  size: 14.5,
                  weight: FontWeight.w500,
                  color: resolvedLabelColor,
                ),
              ),
            ),
            if (showChevron)
              Icon(
                Icons.chevron_right_rounded,
                color: _textMuted,
                size: 22,
              ),
          ],
        ),
      ),
    );
  }

  Widget _switchTile({
    required IconData icon,
    required String label,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: _textPrimary.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, size: 18, color: _textPrimary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: _sf(size: 14.5, weight: FontWeight.w500),
            ),
          ),
          Switch.adaptive(
            value: value,
            onChanged: onChanged,
            activeThumbColor: _brandColor,
            inactiveTrackColor:
                _isDark ? const Color(0xFF3A4354) : Colors.black12,
          ),
        ],
      ),
    );
  }

  Widget _contactTile({
    required IconData icon,
    required String title,
    required String subtitle,
    VoidCallback? onTap,
    Widget? trailing,
  }) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: _brandColor.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, size: 18, color: _brandColor),
      ),
      title: Text(title, style: _sf(size: 14.5, weight: FontWeight.w600)),
      subtitle: Text(subtitle, style: _sf(size: 12.5, color: _textSecondary)),
      trailing: trailing ??
          Icon(Icons.chevron_right_rounded, color: _textMuted, size: 20),
      onTap: onTap,
    );
  }
}
