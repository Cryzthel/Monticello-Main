import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/incident.dart';
import '../services/local_data_store.dart';
import '../theme/app_theme.dart';
import '../widgets/shared_widgets.dart';

class IncidentsScreen extends StatefulWidget {
  const IncidentsScreen({super.key});

  @override
  State<IncidentsScreen> createState() => _IncidentsScreenState();
}

class _IncidentsScreenState extends State<IncidentsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.midnightBase : const Color(0xFFF8F9FA);
    final surface = isDark ? AppColors.midnightSurface : Colors.white;
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
    final tabBg = isDark ? AppColors.midnightSurfaceElevated : Colors.white;
    final tabIndicator =
        isDark ? AppColors.ctaGreen : AppColors.primary;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: bg,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded,
              color: textPrimary, size: 18),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text(
          'My Incidents',
          style: GoogleFonts.inter(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: textPrimary,
          ),
        ),
        centerTitle: false,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FilledButton.icon(
              onPressed: () => Navigator.of(context).pushNamed('/report'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size(0, 36),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
              icon: const Icon(Icons.add_rounded, size: 16),
              label: Text(
                'Report',
                style: GoogleFonts.inter(
                    fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 10),
            child: Container(
              height: 40,
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: isDark
                    ? AppColors.midnightSurface
                    : const Color(0xFFF0F1F4),
                borderRadius: BorderRadius.circular(AppRadius.pill),
              ),
              child: TabBar(
                controller: _tabCtrl,
                indicatorSize: TabBarIndicatorSize.tab,
                indicator: BoxDecoration(
                  color: tabBg,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  boxShadow: [
                    BoxShadow(
                      color:
                          Colors.black.withValues(alpha: isDark ? 0.35 : 0.07),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                dividerColor: Colors.transparent,
                labelStyle: GoogleFonts.inter(
                    fontSize: 12.5, fontWeight: FontWeight.w600),
                unselectedLabelStyle: GoogleFonts.inter(
                    fontSize: 12.5, fontWeight: FontWeight.w500),
                labelColor: tabIndicator,
                unselectedLabelColor: textSecondary,
                tabs: const [
                  Tab(text: 'All'),
                  Tab(text: 'Active'),
                  Tab(text: 'Resolved'),
                ],
              ),
            ),
          ),
        ),
      ),
      body: ListenableBuilder(
        listenable: LocalDataStore.instance,
        builder: (context, _) {
          final all = LocalDataStore.instance.incidents;
          final active =
              all.where((i) => i.status != IncidentStatus.resolved).toList();
          final resolved =
              all.where((i) => i.status == IncidentStatus.resolved).toList();

          return TabBarView(
            controller: _tabCtrl,
            children: [
              _IncidentList(incidents: all, isDark: isDark),
              _IncidentList(incidents: active, isDark: isDark),
              _IncidentList(incidents: resolved, isDark: isDark),
            ],
          );
        },
      ),
    );
  }
}

// ── Incident list ──────────────────────────────────────────────────────────────

class _IncidentList extends StatelessWidget {
  final List<Incident> incidents;
  final bool isDark;

  const _IncidentList({required this.incidents, required this.isDark});

  @override
  Widget build(BuildContext context) {
    if (incidents.isEmpty) return _EmptyState(isDark: isDark);
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
      itemCount: incidents.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, i) =>
          _IncidentCard(incident: incidents[i], isDark: isDark),
    );
  }
}

// ── Incident card ──────────────────────────────────────────────────────────────

class _IncidentCard extends StatelessWidget {
  final Incident incident;
  final bool isDark;

  const _IncidentCard({required this.incident, required this.isDark});

  String _relative(DateTime t) {
    final diff = DateTime.now().difference(t);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final surface =
        isDark ? AppColors.midnightSurfaceElevated : Colors.white;
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
    final textMuted = isDark
        ? AppColors.textSecondaryOnDark.withValues(alpha:0.70)
        : AppColors.textMuted;
    final pColor = IncidentPriorityInfo.color(incident.priority);
    final sColor = IncidentStatusInfo.color(incident.status);
    final border = isDark
        ? AppColors.innerStroke
        : const Color(0xFFEEEFF2);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => showIncidentTimeline(context, incident),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        splashColor: AppColors.primary.withValues(alpha:0.06),
        highlightColor: AppColors.primary.withValues(alpha:0.03),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: surface,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: border),
            boxShadow: [
              BoxShadow(
                color:
                    Colors.black.withValues(alpha:isDark ? 0.38 : 0.04),
                blurRadius: isDark ? 24 : 14,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Top row ────────────────────────────────────────────
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: pColor.withValues(alpha:0.12),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(Icons.shield_rounded,
                        color: pColor, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          incident.title,
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: textPrimary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${incident.id} · ${incident.category}',
                          style: GoogleFonts.inter(
                              fontSize: 11.5, color: textMuted),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 9, vertical: 4),
                        decoration: BoxDecoration(
                          color: sColor.withValues(alpha:0.12),
                          borderRadius:
                              BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          IncidentStatusInfo.label(incident.status),
                          style: GoogleFonts.inter(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            color: sColor,
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _relative(incident.reportedAt),
                        style: GoogleFonts.inter(
                            fontSize: 11, color: textMuted),
                      ),
                    ],
                  ),
                ],
              ),

              // ── Status tracker ─────────────────────────────────────
              ReportStatusTracker(
                  status: incident.status, verticalPadding: 10),

              // ── Footer ─────────────────────────────────────────────
              Row(
                children: [
                  Icon(Icons.location_on_outlined,
                      size: 13, color: textMuted),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      incident.location,
                      style: GoogleFonts.inter(
                          fontSize: 12, color: textSecondary),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Tap hint
                  Row(
                    children: [
                      Text(
                        'View Timeline',
                        style: GoogleFonts.inter(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? AppColors.ctaGreen
                              : AppColors.primary,
                        ),
                      ),
                      const SizedBox(width: 2),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 14,
                        color: isDark
                            ? AppColors.ctaGreen
                            : AppColors.primary,
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Empty state ────────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  final bool isDark;

  const _EmptyState({required this.isDark});

  @override
  Widget build(BuildContext context) {
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary =
        isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primary.withValues(alpha:0.08),
              ),
              child: const Icon(Icons.shield_outlined,
                  color: AppColors.primary, size: 32),
            ),
            const SizedBox(height: 16),
            Text(
              'No Reports Found',
              style: GoogleFonts.inter(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Reports you file will appear here with live status tracking.',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                fontSize: 13.5,
                color: textSecondary,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pushNamed('/report'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(
                    horizontal: 22, vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
              icon: const Icon(Icons.add_alert_outlined, size: 16),
              label: Text(
                'File a Report',
                style: GoogleFonts.inter(
                    fontSize: 14, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
