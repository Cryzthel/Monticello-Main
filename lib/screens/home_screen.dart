import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_container.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/shared_widgets.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _navIndex = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      const _DashboardTab(),
      const _IncidentsTab(),
      const _AnnouncementsTab(),
      const _ProfileTab(),
    ];
    return GradientScaffold(
      body: pages[_navIndex],
      floatingActionButton: _navIndex == 0
          ? FloatingActionButton.extended(
              onPressed: () =>
                  Navigator.of(context).pushNamed('/panic'),
              backgroundColor: AppColors.danger,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.warning_amber_rounded),
              label: Text(
                'PANIC',
                style: GoogleFonts.inter(
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                ),
              ),
            )
          : null,
      bottomNavigationBar: _GlassBottomNav(
        index: _navIndex,
        onChanged: (i) => setState(() => _navIndex = i),
      ),
    );
  }
}

class _GlassBottomNav extends StatelessWidget {
  final int index;
  final ValueChanged<int> onChanged;

  const _GlassBottomNav({required this.index, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    const items = [
      (Icons.dashboard_outlined, Icons.dashboard, 'Home'),
      (Icons.report_outlined, Icons.report, 'Incidents'),
      (Icons.campaign_outlined, Icons.campaign, 'Updates'),
      (Icons.person_outline, Icons.person, 'Profile'),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.md,
      ),
      child: GlassContainer(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.sm,
        ),
        borderRadius: AppRadius.pill,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: List.generate(items.length, (i) {
            final selected = i == index;
            return GestureDetector(
              onTap: () => onChanged(i),
              behavior: HitTestBehavior.opaque,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOut,
                padding: EdgeInsets.symmetric(
                  horizontal: selected ? AppSpacing.md : AppSpacing.sm,
                  vertical: AppSpacing.sm + 2,
                ),
                decoration: BoxDecoration(
                  color: selected
                      ? AppColors.accent.withOpacity(0.22)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  border: selected
                      ? Border.all(color: AppColors.accent.withOpacity(0.5))
                      : null,
                ),
                child: Row(
                  children: [
                    Icon(
                      selected ? items[i].$2 : items[i].$1,
                      color: selected
                          ? AppColors.accent
                          : AppColors.textMuted,
                      size: 20,
                    ),
                    if (selected) ...[
                      const SizedBox(width: 6),
                      Text(
                        items[i].$3,
                        style: GoogleFonts.inter(
                          color: AppColors.accent,
                          fontWeight: FontWeight.w600,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

/* ------------------------- Dashboard Tab ------------------------- */

class _DashboardTab extends StatelessWidget {
  const _DashboardTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        120,
      ),
      children: [
        _HeaderGreeting(),
        const SizedBox(height: AppSpacing.lg),
        _StatusBanner(),
        const SizedBox(height: AppSpacing.lg),
        const SectionHeader(
          title: 'Quick actions',
          icon: Icons.flash_on_outlined,
        ),
        const SizedBox(height: AppSpacing.xs),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 2,
          mainAxisSpacing: AppSpacing.md,
          crossAxisSpacing: AppSpacing.md,
          childAspectRatio: 1.35,
          children: [
            QuickActionTile(
              icon: Icons.add_alert_outlined,
              label: 'Report incident',
              accent: AppColors.accent,
              onTap: () =>
                  Navigator.of(context).pushNamed('/report'),
            ),
            QuickActionTile(
              icon: Icons.map_outlined,
              label: 'Subdivision map',
              accent: AppColors.info,
              onTap: () => Navigator.of(context).pushNamed('/map'),
            ),
            QuickActionTile(
              icon: Icons.campaign_outlined,
              label: 'Announcements',
              accent: AppColors.success,
              onTap: () =>
                  Navigator.of(context).pushNamed('/announcements'),
            ),
            QuickActionTile(
              icon: Icons.list_alt_outlined,
              label: 'My reports',
              accent: const Color(0xFFA78BFA),
              onTap: () =>
                  Navigator.of(context).pushNamed('/incidents'),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        SectionHeader(
          title: 'Active incidents',
          icon: Icons.timeline_outlined,
          action: 'View all',
          onAction: () => Navigator.of(context).pushNamed('/incidents'),
        ),
        const SizedBox(height: AppSpacing.xs),
        ...MockData.incidents
            .take(2)
            .map((i) => Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: IncidentCard(incident: i),
                )),
        const SizedBox(height: AppSpacing.md),
        SectionHeader(
          title: 'Latest announcement',
          icon: Icons.newspaper_outlined,
          action: 'See all',
          onAction: () =>
              Navigator.of(context).pushNamed('/announcements'),
        ),
        const SizedBox(height: AppSpacing.xs),
        AnnouncementCard(announcement: MockData.announcements.first),
      ],
    );
  }
}

class _HeaderGreeting extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good morning'
        : hour < 18
            ? 'Good afternoon'
            : 'Good evening';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                greeting,
                style: GoogleFonts.inter(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Homeowner Dela Cruz',
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Phase 2 • Block 14 • Lot 07',
                style: GoogleFonts.inter(
                  fontSize: 12,
                  color: AppColors.textMuted,
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
        ),
        GlassContainer(
          width: 44,
          height: 44,
          borderRadius: 14,
          padding: EdgeInsets.zero,
          onTap: () {},
          child: const Stack(
            alignment: Alignment.center,
            children: [
              Icon(Icons.notifications_outlined,
                  color: AppColors.textPrimary),
              Positioned(
                right: 10,
                top: 10,
                child: CircleAvatar(
                  radius: 4,
                  backgroundColor: AppColors.accent,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StatusBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      padding: const EdgeInsets.all(AppSpacing.lg),
      tint: AppColors.success,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.success.withOpacity(0.22),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.success.withOpacity(0.5)),
            ),
            child: const Icon(Icons.shield_outlined,
                color: AppColors.success),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Community secure',
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'No critical incidents in the last 24 hours.',
                  style: GoogleFonts.inter(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right,
              color: AppColors.textSecondary.withOpacity(0.7)),
        ],
      ),
    );
  }
}

/* ----------------------------- Cards ----------------------------- */

class IncidentCard extends StatelessWidget {
  final Incident incident;
  const IncidentCard({super.key, required this.incident});

  @override
  Widget build(BuildContext context) {
    final pColor = IncidentPriorityInfo.color(incident.priority);
    final sColor = IncidentStatusInfo.color(incident.status);
    return GlassContainer(
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () {},
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: pColor.withOpacity(0.18),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: pColor.withOpacity(0.4)),
                ),
                child: Icon(Icons.report_gmailerrorred_outlined,
                    color: pColor, size: 20),
              ),
              const SizedBox(width: AppSpacing.sm + 2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      incident.title,
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${incident.id} • ${incident.category}',
                      style: GoogleFonts.inter(
                        fontSize: 11,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              StatusChip(
                label: IncidentStatusInfo.label(incident.status),
                color: sColor,
                icon: IncidentStatusInfo.icon(incident.status),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Divider(height: 1, color: Colors.white.withOpacity(0.1)),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              const Icon(Icons.location_on_outlined,
                  size: 14, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  incident.location,
                  style: GoogleFonts.inter(
                    fontSize: 11.5,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              Text(
                _relative(incident.reportedAt),
                style: GoogleFonts.inter(
                  fontSize: 11,
                  color: AppColors.textMuted,
                ),
              ),
            ],
          ),
        ],
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

class AnnouncementCard extends StatelessWidget {
  final Announcement announcement;
  const AnnouncementCard({super.key, required this.announcement});

  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () {},
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (announcement.pinned)
                const Padding(
                  padding: EdgeInsets.only(right: 6),
                  child: Icon(Icons.push_pin,
                      size: 14, color: AppColors.accent),
                ),
              Expanded(
                child: Text(
                  announcement.title,
                  style: GoogleFonts.inter(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              StatusChip(
                label: announcement.category,
                color: AppColors.info,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            announcement.body,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(
              fontSize: 12.5,
              color: AppColors.textSecondary,
              height: 1.4,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              const Icon(Icons.account_circle_outlined,
                  size: 14, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Text(
                announcement.author,
                style: GoogleFonts.inter(
                  fontSize: 11,
                  color: AppColors.textMuted,
                ),
              ),
              const Spacer(),
              Text(
                DateFormat('MMM d • h:mm a').format(announcement.postedAt),
                style: GoogleFonts.inter(
                  fontSize: 11,
                  color: AppColors.textMuted,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/* ----------------- Placeholder tabs (wired to full screens via routes) ----------------- */

class _IncidentsTab extends StatelessWidget {
  const _IncidentsTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
      children: [
        Text(
          'My incidents',
          style: GoogleFonts.inter(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Track the status of every report you\'ve filed.',
          style: GoogleFonts.inter(
            fontSize: 13,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        ...MockData.incidents.map((i) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: IncidentCard(incident: i),
            )),
      ],
    );
  }
}

class _AnnouncementsTab extends StatelessWidget {
  const _AnnouncementsTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
      children: [
        Text(
          'Announcements',
          style: GoogleFonts.inter(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Real-time updates from HOA and security.',
          style: GoogleFonts.inter(
            fontSize: 13,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        ...MockData.announcements.map((a) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: AnnouncementCard(announcement: a),
            )),
      ],
    );
  }
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
      children: [
        Center(
          child: GlassContainer(
            width: 96,
            height: 96,
            borderRadius: 32,
            padding: EdgeInsets.zero,
            child: const Center(
              child: Icon(Icons.person, size: 52, color: AppColors.accent),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Center(
          child: Text(
            'Juan Dela Cruz',
            style: GoogleFonts.inter(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        Center(
          child: Text(
            'Verified Resident • Phase 2 Block 14 Lot 07',
            style: GoogleFonts.inter(
              fontSize: 12,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        GlassContainer(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _profileTile(Icons.shield_outlined, 'Security preferences'),
              _divider(),
              _profileTile(Icons.notifications_outlined, 'Notification settings'),
              _divider(),
              _profileTile(Icons.location_on_outlined, 'Property details'),
              _divider(),
              _profileTile(Icons.support_agent_outlined, 'Contact HOA office'),
              _divider(),
              _profileTile(Icons.logout_outlined, 'Sign out',
                  danger: true),
            ],
          ),
        ),
      ],
    );
  }

  Widget _divider() =>
      Divider(height: 1, color: Colors.white.withOpacity(0.08));

  Widget _profileTile(IconData icon, String label, {bool danger = false}) {
    final color = danger ? AppColors.danger : AppColors.textPrimary;
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(label,
          style: GoogleFonts.inter(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: color)),
      trailing:
          const Icon(Icons.chevron_right, color: AppColors.textMuted),
      onTap: () {},
    );
  }
}
