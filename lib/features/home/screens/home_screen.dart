import 'dart:ui';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../models/incident.dart';
import '../services/local_data_store.dart';
import '../services/property_storage.dart';
import '../services/user_profile_service.dart';
import '../theme/app_theme.dart';
import '../widgets/shared_widgets.dart';

TextStyle _inter({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
  double letterSpacing = 0,
  double height = 1.35,
}) {
  return GoogleFonts.inter(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}

class _HomeVisual {
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color surface;
  final Color bg;
  final Color border;
  final Color brandColor;
  final bool isDark;

  const _HomeVisual({
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.surface,
    required this.bg,
    required this.border,
    required this.brandColor,
    required this.isDark,
  });

  factory _HomeVisual.of(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    if (dark) {
      return _HomeVisual(
        textPrimary: AppColors.textPrimaryOnDark,
        textSecondary: AppColors.textSecondaryOnDark,
        textMuted: AppColors.textMutedOnDark,
        surface: AppColors.midnightSurfaceElevated,
        bg: AppColors.midnightBase,
        border: AppColors.innerStroke,
        brandColor: AppColors.primaryLight,
        isDark: true,
      );
    }
    return const _HomeVisual(
      textPrimary: AppColors.textPrimary,
      textSecondary: AppColors.textSecondary,
      textMuted: AppColors.textMuted,
      surface: AppColors.surfaceLight,
      bg: AppColors.bgLight,
      border: AppColors.divider,
      brandColor: AppColors.primary,
      isDark: false,
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _navIndex = 0;

  @override
  void initState() {
    super.initState();
    UserProfileService.instance.load();
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      const _HomeTab(),
      const _UpdatesTab(),
      const _IncidentsTab(),
      const _ProfileTab(),
    ];
    final visual = _HomeVisual.of(context);

    return Scaffold(
      backgroundColor: visual.bg,
      extendBody: true,
      body: Stack(
        children: [
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 250),
            child: pages[_navIndex],
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.only(
                bottom: 24,
                left: 20,
                right: 20,
              ),
              child: _buildFloatingNavBar(context, visual.isDark),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFloatingNavBar(BuildContext context, bool isDark) {
    final inactive = isDark ? AppColors.textSecondaryOnDark : AppColors.textMuted;
    final active = isDark ? Colors.white : AppColors.primary;

    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          height: 72,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            color: isDark
                ? AppColors.midnightSurface.withValues(alpha: 0.85)
                : Colors.white.withValues(alpha: 0.95),
            border: Border.all(
              color: isDark
                  ? AppColors.innerStroke
                  : Colors.black.withOpacity(0.05),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(isDark ? 0.4 : 0.08),
                blurRadius: 24,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildNavItem(0, Icons.home_rounded, Icons.home_outlined, 'Home',
                  active, inactive),
              _buildNavItem(1, Icons.campaign_rounded,
                  Icons.campaign_outlined, 'Updates', active, inactive),
              _buildPanicButton(context),
              _buildNavItem(2, Icons.shield_rounded, Icons.shield_outlined,
                  'Incidents', active, inactive),
              _buildNavItem(3, Icons.person_rounded,
                  Icons.person_outline_rounded, 'Profile', active, inactive),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNavItem(int index, IconData activeIcon, IconData inactiveIcon,
      String label, Color activeColor, Color inactiveColor) {
    final isActive = _navIndex == index;

    return GestureDetector(
      onTap: () => setState(() => _navIndex = index),
      behavior: HitTestBehavior.opaque,
      child: SizedBox(
        width: 56,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              isActive ? activeIcon : inactiveIcon,
              color: isActive ? activeColor : inactiveColor,
              size: 22,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 10,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                color: isActive ? activeColor : inactiveColor,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPanicButton(BuildContext context) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.mediumImpact();
        Navigator.of(context).pushNamed('/panic');
      },
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.panicOxblood,
              Color.lerp(AppColors.panicOxblood, Colors.black, 0.2)!,
            ],
          ),
          border: Border.all(color: Colors.white, width: 2.5),
          boxShadow: [
            BoxShadow(
              color: AppColors.panicOxblood.withOpacity(0.5),
              blurRadius: 16,
              spreadRadius: 0,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: const Icon(Icons.sos_rounded, color: Colors.white, size: 24),
      ),
    );
  }
}

/* ============================ HOME TAB ============================ */

class _HomeTab extends StatefulWidget {
  const _HomeTab();

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<_HomeTab> {
  late Future<({String name, String address})> _greetingFuture;

  @override
  void initState() {
    super.initState();
    _greetingFuture = _loadGreeting();
  }

  Future<({String name, String address})> _loadGreeting() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      return (name: 'Resident', address: 'Sign in to continue');
    }
    final profile = UserProfileService.instance.profile ?? await UserProfileService.instance.load();
    final prop = await PropertyStorage.loadForUser(user.uid);
    final name = (profile?.name.isNotEmpty ?? false)
        ? profile!.name
        : ((user.displayName != null && user.displayName!.trim().isNotEmpty)
            ? user.displayName!.trim()
            : (user.email?.split('@').first ?? 'Resident'));
    final address = prop != null
        ? 'Phase ${prop.phase} • Block ${prop.block} • Lot ${prop.lot}'
        : 'Complete property verification';
    return (name: name, address: address);
  }

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: LocalDataStore.instance,
        builder: (context, _) {
          final store = LocalDataStore.instance;
          return ListView(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.screenGutter,
              AppSpacing.md,
              AppSpacing.screenGutter,
              AppSpacing.navClearance,
            ), 
            children: [
              FutureBuilder<({String name, String address})>(
                future: _greetingFuture,
                builder: (context, snapshot) {
                  final name = snapshot.data?.name ?? '...';
                  final address = snapshot.data?.address ?? '';
                  return _Greeting(
                    greeting: _greeting,
                    name: name,
                    address: address,
                  );
                },
              ),
              const SizedBox(height: 32),
              
              const _QuickActionsRow(), // Keep features, upgraded design
              const SizedBox(height: 36),
              
              // 1. Featured Section (Matches the large image card inspiration)
              _SectionTitle(
                title: 'Featured Announcement',
                actionLabel: store.announcements.isEmpty ? null : 'See All',
                onAction: store.announcements.isEmpty
                    ? null
                    : () => Navigator.of(context).pushNamed('/announcements'),
              ),
              const SizedBox(height: 16),
              if (store.announcements.isEmpty)
                const _EmptyCard(
                  icon: Icons.campaign_outlined,
                  title: 'No Announcements',
                  subtitle: 'Community updates from HOA will show up here.',
                )
              else
                _FeaturedAnnouncementCard(announcement: store.announcements.first),

              const SizedBox(height: 36),
              
              // 2. Ongoing Section (Matches the clean list inspiration)
              _SectionTitle(
                title: 'Ongoing Incidents',
                actionLabel: store.incidents.isEmpty ? null : 'See All',
                onAction: store.incidents.isEmpty
                    ? null
                    : () => Navigator.of(context).pushNamed('/incidents'),
              ),
              const SizedBox(height: 16),
              if (store.incidents.isEmpty)
                const _EmptyCard(
                  icon: Icons.verified_user_outlined,
                  title: 'Community Secure',
                  subtitle: 'No active incidents reported. Your community is safe.',
                )
              else
                ...store.incidents.take(2).map(
                      (i) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _IncidentCard(incident: i),
                      ),
                    ),
            ],
          );
        },
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  final String greeting;
  final String name;
  final String address;
  const _Greeting({
    required this.greeting,
    required this.name,
    required this.address,
  });

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(greeting,
                  style: _inter(size: 14, color: v.textSecondary)),
              Text(
                name,
                style: _inter(
                  size: 24,
                  weight: FontWeight.w700,
                  letterSpacing: -0.5,
                  height: 1.2,
                  color: v.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Icon(Icons.pin_drop_rounded,
                      size: 14, color: v.brandColor),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      address,
                      style: _inter(
                          size: 13,
                          color: v.textSecondary,
                          weight: FontWeight.w500),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        GestureDetector(
          onTap: () => Navigator.of(context).pushNamed('/announcements'),
          behavior: HitTestBehavior.opaque,
          child: Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: v.surface,
              boxShadow: [
                BoxShadow(
                  color:
                      Colors.black.withOpacity(v.isDark ? 0.35 : 0.06),
                  blurRadius: v.isDark ? 20 : 12,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(Icons.notifications_none_rounded,
                    color: v.textPrimary, size: 24),
                Positioned(
                  right: 12,
                  top: 12,
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: v.brandColor,
                      border: Border.all(color: v.surface, width: 1.5),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  const _SectionTitle({required this.title, this.actionLabel, this.onAction});

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: _inter(
              size: 18,
              weight: FontWeight.w700,
              letterSpacing: -0.3,
              color: v.textPrimary),
        ),
        if (actionLabel != null)
          GestureDetector(
            onTap: onAction,
            behavior: HitTestBehavior.opaque,
            child: Text(
              actionLabel!,
              style: _inter(
                  size: 13,
                  weight: FontWeight.w600,
                  color: v.textSecondary),
            ),
          ),
      ],
    );
  }
}

class _QuickActionsRow extends StatelessWidget {
  const _QuickActionsRow();

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    final items = <_QuickAction>[
      _QuickAction(
          icon: Icons.report_rounded,
          label: 'Report',
          accent: v.brandColor,
          onTap: () => Navigator.of(context).pushNamed('/report')),
      _QuickAction(
          icon: Icons.explore_rounded,
          label: 'Map',
          accent: AppColors.info,
          onTap: () => Navigator.of(context).pushNamed('/map')),
      _QuickAction(
          icon: Icons.receipt_long_rounded,
          label: 'History',
          accent: AppColors.success,
          onTap: () => Navigator.of(context).pushNamed('/incidents')),
    ];
    return Row(
      children: items
          .map((a) => Expanded(
                  child: Padding(
                    padding:
                        const EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                    child: _QuickActionButton(action: a),
                  ),
                ))
          .toList(),
    );
  }
}

class _QuickAction {
  final IconData icon;
  final String label;
  final Color accent;
  final VoidCallback onTap;
  const _QuickAction({required this.icon, required this.label, required this.onTap, required this.accent});
}

class _QuickActionButton extends StatelessWidget {
  final _QuickAction action;
  const _QuickActionButton({required this.action});

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    return GestureDetector(
      onTap: action.onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding:
            const EdgeInsets.symmetric(vertical: AppSpacing.md),
        decoration: BoxDecoration(
          color: v.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: v.border),
        ),
        child: Column(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: action.accent.withOpacity(v.isDark ? 0.2 : 0.12),
              ),
              child: Icon(action.icon, color: action.accent, size: 22),
            ),
            const SizedBox(height: 8),
            Text(
              action.label,
              style:
                  _inter(size: 13, weight: FontWeight.w600, color: v.textPrimary),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------- Inspiration-style Featured Card ----------------
class _FeaturedAnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  const _FeaturedAnnouncementCard({required this.announcement});

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    final bubble = v.isDark ? AppColors.midnightBase : AppColors.textPrimary;

    return Container(
      height: 280,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.xl),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.primary,
            Color.lerp(AppColors.primary, Colors.black, 0.42)!,
          ],
        ),
        boxShadow: [
          BoxShadow(
              color: AppColors.primary
                  .withOpacity(v.isDark ? 0.50 : 0.28),
              blurRadius: 24,
              offset: const Offset(0, 12))
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            top: 20,
            left: 20,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: v.isDark
                    ? AppColors.midnightSurface.withValues(alpha: 0.88)
                    : Colors.white.withOpacity(0.94),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.25),
                    blurRadius: 14,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Icon(Icons.campaign_rounded,
                      size: 16, color: v.brandColor),
                  const SizedBox(width: 8),
                  Text(
                    announcement.category,
                    style: _inter(
                      size: 13,
                      weight: FontWeight.w700,
                      color: v.textPrimary,
                    ).copyWith(shadows: const [
                      Shadow(
                          color: Color(0x33000000),
                          blurRadius: 6,
                          offset: Offset(0, 1)),
                    ]),
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            top: 20,
            right: 20,
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: v.isDark
                    ? AppColors.midnightSurface.withValues(alpha: 0.88)
                    : Colors.white.withOpacity(0.94),
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.22),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Icon(Icons.push_pin_rounded,
                  size: 20, color: v.textPrimary),
            ),
          ),
          Positioned(
            bottom: 12,
            left: 12,
            right: 12,
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color:
                    v.isDark ? v.surface.withValues(alpha: 0.94) : Colors.white,
                borderRadius: BorderRadius.circular(AppRadius.lg),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.14),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 50,
                    height: 50,
                    decoration: BoxDecoration(
                      color: bubble,
                      shape: BoxShape.circle,
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(DateFormat('dd').format(announcement.postedAt),
                            style: _inter(
                                size: 16,
                                weight: FontWeight.w800,
                                color: Colors.white,
                                height: 1.0)),
                        Text(DateFormat('MMM').format(announcement.postedAt),
                            style: _inter(
                                size: 10,
                                color: Colors.white70,
                                height: 1.2)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          announcement.title,
                          style: _inter(
                            size: 15,
                            weight: FontWeight.w700,
                            color: v.textPrimary,
                          ).copyWith(shadows: const [
                            Shadow(
                                color: Color(0x14000000),
                                blurRadius: 4,
                                offset: Offset(0, 1)),
                          ]),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Icon(Icons.person_outline_rounded,
                                size: 14, color: v.textSecondary),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                announcement.author,
                                style:
                                    _inter(size: 12, color: v.textSecondary),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _EmptyCard({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: v.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: [
          BoxShadow(
              color:
                  Colors.black.withOpacity(v.isDark ? 0.45 : 0.06),
              blurRadius: 22,
              offset: const Offset(0, 10)),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: v.brandColor.withOpacity(v.isDark ? 0.22 : 0.08),
            ),
            child: Icon(Icons.shield_outlined,
                color: v.brandColor, size: 28),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(title,
              style: _inter(
                  size: 16,
                  weight: FontWeight.w600,
                  color: v.textPrimary)),
          const SizedBox(height: 6),
          Text(subtitle,
              textAlign: TextAlign.center,
              style: _inter(
                  size: 13, color: v.textSecondary, height: 1.4)),
        ],
      ),
    );
  }
}

class _IncidentCard extends StatelessWidget {
  final Incident incident;
  const _IncidentCard({required this.incident});

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    final pColor = IncidentPriorityInfo.color(incident.priority);
    final sColor = IncidentStatusInfo.color(incident.status);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => showIncidentTimeline(context, incident),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        splashColor: v.brandColor.withOpacity(0.06),
        highlightColor: v.brandColor.withOpacity(0.03),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.cardPadding),
          decoration: BoxDecoration(
            color: v.surface,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            boxShadow: [
              BoxShadow(
                  color: Colors.black
                      .withOpacity(v.isDark ? 0.5 : 0.04),
                  blurRadius: 20,
                  offset: const Offset(0, 8)),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                        color: pColor.withOpacity(0.14),
                        borderRadius: BorderRadius.circular(14)),
                    child: Icon(Icons.security_rounded,
                        color: pColor, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          incident.title,
                          style: _inter(
                              size: 15,
                              weight: FontWeight.w600,
                              color: v.textPrimary),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${incident.id} • ${incident.category}',
                          style:
                              _inter(size: 12, color: v.textMuted),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                        color: sColor.withOpacity(0.14),
                        borderRadius: BorderRadius.circular(8)),
                    child: Text(
                      IncidentStatusInfo.label(incident.status),
                      style: _inter(
                          size: 11,
                          weight: FontWeight.w700,
                          color: sColor,
                          letterSpacing: 0.3),
                    ),
                  ),
                ],
              ),
              ReportStatusTracker(status: incident.status),
              Row(
                children: [
                  Icon(Icons.location_on_rounded,
                      size: 14, color: v.textSecondary),
                  const SizedBox(width: 6),
                  Expanded(
                      child: Text(incident.location,
                          style: _inter(
                              size: 13, color: v.textSecondary))),
                  Text(_relative(incident.reportedAt),
                      style:
                          _inter(size: 12, color: v.textMuted)),
                  const SizedBox(width: 8),
                  Icon(Icons.chevron_right_rounded,
                      size: 16, color: v.brandColor),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _relative(DateTime t) {
    final diff = DateTime.now().difference(t);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}

/* ============================ UPDATES TAB ============================ */

class _UpdatesTab extends StatelessWidget {
  const _UpdatesTab();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: LocalDataStore.instance,
        builder: (context, _) {
          final list = LocalDataStore.instance.announcements;
          final v = _HomeVisual.of(context);
          return ListView(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.screenGutter,
              AppSpacing.sm + 10,
              AppSpacing.screenGutter,
              AppSpacing.navClearance,
            ),
            children: [
              Text(
                'Updates',
                style: _inter(
                    size: 28,
                    weight: FontWeight.w700,
                    letterSpacing: -0.5,
                    color: v.textPrimary),
              ),
              const SizedBox(height: 6),
              Text(
                'Real-time updates from HOA and security.',
                style: _inter(size: 14, color: v.textSecondary),
              ),
              SizedBox(height: AppSpacing.sm + 14),
              if (list.isEmpty)
                const _EmptyCard(
                  icon: Icons.newspaper_rounded,
                  title: 'No Announcements',
                  subtitle: 'New community posts will appear here automatically.',
                )
              else
                ...list.map(
                  (a) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _AnnouncementListCard(announcement: a),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _AnnouncementListCard extends StatelessWidget {
  final Announcement announcement;
  const _AnnouncementListCard({required this.announcement});

  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.cardPadding),
      decoration: BoxDecoration(
        color: v.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: [
          BoxShadow(
              color:
                  Colors.black.withOpacity(v.isDark ? 0.5 : 0.04),
              blurRadius: 18,
              offset: const Offset(0, 8)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (announcement.pinned) ...[
                Icon(Icons.push_pin_rounded,
                    size: 16, color: v.brandColor),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: Text(
                  announcement.title,
                  style: _inter(
                      size: 16,
                      weight: FontWeight.w700,
                      color: v.textPrimary),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: v.brandColor.withOpacity(v.isDark ? 0.22 : 0.08),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  announcement.category,
                  style: _inter(
                      size: 11,
                      weight: FontWeight.w700,
                      color: v.brandColor),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm + 2),
          Text(
            announcement.body,
            style: _inter(
                size: 13.5, color: v.textSecondary, height: 1.5),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                    shape: BoxShape.circle, color: v.bg.withOpacity(0.5)),
                child:
                    Icon(Icons.person_rounded, size: 14, color: v.textSecondary),
              ),
              const SizedBox(width: 8),
              Text(announcement.author,
                  style: _inter(size: 12, color: v.textSecondary)),
              const Spacer(),
              Text(
                DateFormat('MMM d • h:mm a').format(announcement.postedAt),
                style: _inter(size: 12, color: v.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/* ============================ INCIDENTS TAB ============================ */

class _IncidentsTab extends StatelessWidget {
  const _IncidentsTab();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: LocalDataStore.instance,
        builder: (context, _) {
          final list = LocalDataStore.instance.incidents;
          final v = _HomeVisual.of(context);
          return ListView(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.screenGutter,
              AppSpacing.sm + 10,
              AppSpacing.screenGutter,
              AppSpacing.navClearance,
            ),
            children: [
              Text(
                'My Incidents',
                style: _inter(
                    size: 28,
                    weight: FontWeight.w700,
                    letterSpacing: -0.5,
                    color: v.textPrimary),
              ),
              const SizedBox(height: 6),
              Text(
                'Track the status of every report you\'ve filed.',
                style: _inter(size: 14, color: v.textSecondary),
              ),
              SizedBox(height: AppSpacing.sm + 14),
              PrimaryButton(
                label: 'Report New Incident',
                icon: Icons.add_moderator_rounded,
                onPressed: () => Navigator.of(context).pushNamed('/report'),
              ),
              SizedBox(height: AppSpacing.sm + 14),
              if (list.isEmpty)
                const _EmptyCard(
                  icon: Icons.shield_rounded,
                  title: 'No Reports Yet',
                  subtitle: 'When you file a report, it will appear here for tracking.',
                )
              else
                ...list.map(
                  (i) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _IncidentCard(incident: i),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/* ============================ PROFILE TAB ============================ */

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: UserProfileService.instance,
        builder: (context, _) {
          final profile = UserProfileService.instance.profile;
          final name = profile?.name ?? 'Resident';
          final email = profile?.email ?? '';
          final initials = name.isNotEmpty
              ? name.trim().substring(0, 1).toUpperCase()
              : (email.isNotEmpty ? email.substring(0, 1).toUpperCase() : 'M');
          final v = _HomeVisual.of(context);

          return ListView(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.screenGutter,
              AppSpacing.sm + 10,
              AppSpacing.screenGutter,
              AppSpacing.navClearance,
            ),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Profile',
                    style: _inter(
                      size: 28,
                      weight: FontWeight.w700,
                      letterSpacing: -0.5,
                      color: v.textPrimary,
                    ),
                  ),
                  IconButton(
                    onPressed: () =>
                        Navigator.of(context).pushNamed('/settings'),
                    icon: Icon(Icons.settings_rounded,
                        color: v.textPrimary, size: 28),
                  ),
                ],
              ),
              SizedBox(height: AppSpacing.sm + 14),
              Center(
                child: Column(
                  children: [
                    Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: v.surface,
                        border: Border.all(
                            color:
                                v.brandColor.withOpacity(v.isDark ? 0.45 : 0.35),
                            width: 2),
                        boxShadow: [
                          BoxShadow(
                              color:
                                  v.brandColor.withOpacity(v.isDark ? 0.35 : 0.12),
                              blurRadius: 24,
                              offset: const Offset(0, 10)),
                        ],
                      ),
                      child: Center(
                        child: Text(
                          initials,
                          style: _inter(
                              size: 36,
                              weight: FontWeight.w700,
                              color: v.brandColor),
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(name,
                        style: _inter(
                            size: 20,
                            weight: FontWeight.w700,
                            color: v.textPrimary)),
                    const SizedBox(height: 4),
                    Text(email,
                        style:
                            _inter(size: 14, color: v.textSecondary)),
                    if (profile?.bio.isNotEmpty == true) ...[
                      const SizedBox(height: AppSpacing.sm + 2),
                      Padding(
                        padding: EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm + 14),
                        child: Text(
                          profile!.bio,
                          textAlign: TextAlign.center,
                          style: _inter(
                              size: 13, color: v.textSecondary, height: 1.5),
                        ),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.sm + 11),
                    SizedBox(
                      height: 44,
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            Navigator.of(context).pushNamed('/edit-profile'),
                        icon: Icon(Icons.edit_rounded,
                            size: 18, color: v.brandColor),
                        label: Text(
                          'Edit Profile',
                          style: _inter(
                              size: 14,
                              weight: FontWeight.w600,
                              color: v.brandColor),
                        ),
                        style: OutlinedButton.styleFrom(
                          side: BorderSide(
                              color: v.brandColor.withOpacity(0.5),
                              width: 1.5),
                          backgroundColor:
                              v.brandColor.withOpacity(v.isDark ? 0.18 : 0.05),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(999)),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(height: AppSpacing.md + 3),
              Container(
                decoration: BoxDecoration(
                  color: v.surface,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  boxShadow: [
                    BoxShadow(
                      color:
                          Colors.black.withOpacity(v.isDark ? 0.5 : 0.04),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    _profileTile(
                      context,
                      icon: Icons.tune_rounded,
                      label: 'Settings',
                      onTap: () => Navigator.of(context).pushNamed('/settings'),
                    ),
                    const _TileDivider(),
                    _profileTile(
                      context,
                      icon: Icons.maps_home_work_rounded,
                      label: 'Property Details',
                      onTap: () => Navigator.of(context).pushNamed('/property-details'),
                    ),
                    const _TileDivider(),
                    _profileTile(
                      context,
                      icon: Icons.notifications_active_rounded,
                      label: 'Notifications',
                      onTap: () => Navigator.of(context).pushNamed('/settings'),
                    ),
                    const _TileDivider(),
                    _profileTile(
                      context,
                      icon: Icons.logout_rounded,
                      label: 'Sign Out',
                      iconColor: AppColors.danger,
                      labelColor: AppColors.danger,
                      showChevron: false,
                      onTap: () async {
                        await FirebaseAuth.instance.signOut();
                        UserProfileService.instance.clear();
                        if (context.mounted) {
                          Navigator.of(context).pushNamedAndRemoveUntil('/login', (_) => false);
                        }
                      },
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _profileTile(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    Color? iconColor,
    Color? labelColor,
    bool showChevron = true,
  }) {
    final v = _HomeVisual.of(context);
    final resolvedIconColor = iconColor ?? v.textPrimary;
    final resolvedLabelColor = labelColor ?? v.textPrimary;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: resolvedIconColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, size: 20, color: resolvedIconColor),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                label,
                style: _inter(size: 15, weight: FontWeight.w500, color: resolvedLabelColor),
              ),
            ),
            if (showChevron)
              Icon(Icons.chevron_right_rounded,
                  color: v.textMuted, size: 22),
          ],
        ),
      ),
    );
  }
}

class _TileDivider extends StatelessWidget {
  const _TileDivider();
  @override
  Widget build(BuildContext context) {
    final v = _HomeVisual.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 72),
      child: Divider(
        height: 1,
        thickness: 1,
        color:
            Color.lerp(v.border, Colors.transparent, v.isDark ? 0.2 : 0.35)!,
      ),
    );
  }
}