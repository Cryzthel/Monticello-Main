import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../models/incident.dart';
import '../services/local_data_store.dart';
import '../theme/app_theme.dart';

class AnnouncementsScreen extends StatefulWidget {
  const AnnouncementsScreen({super.key});

  @override
  State<AnnouncementsScreen> createState() => _AnnouncementsScreenState();
}

class _AnnouncementsScreenState extends State<AnnouncementsScreen> {
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _bg => _isDark ? AppColors.midnightBase : AppColors.bgLight;
  Color get _primary => _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _secondary => _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  Color get _dividerC => _isDark ? const Color(0xFF21262D) : AppColors.divider;
  Color get _brandColor => _isDark ? AppColors.primaryLight : AppColors.primary;

  String _filter = 'All';
  final _filters = const ['All', 'Utilities', 'Security', 'Events'];

  TextStyle _sf({
    double size = 15,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double letterSpacing = 0,
    double height = 1.35,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color ?? _primary,
      letterSpacing: letterSpacing,
      height: height,
    ).copyWith(
      fontFamilyFallback: const ['SF Pro Text', 'SF Pro Display', 'Roboto'],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, color: _primary, size: 18),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        centerTitle: true,
        title: Text(
          'Announcements',
          style: _sf(size: 16, weight: FontWeight.w600),
        ),
      ),
      body: ListenableBuilder(
        listenable: LocalDataStore.instance,
        builder: (context, _) {
          final all = LocalDataStore.instance.announcements;
          final list = _filter == 'All'
              ? all
              : all.where((a) => a.category == _filter).toList();
          return Column(
            children: [
              SizedBox(
                height: 44,
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  scrollDirection: Axis.horizontal,
                  itemCount: _filters.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final f = _filters[i];
                    final selected = f == _filter;
                    return GestureDetector(
                      onTap: () => setState(() => _filter = f),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: selected
                              ? _brandColor.withValues(alpha: 0.08)
                              : (_isDark ? AppColors.midnightSurface : Colors.white),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: selected ? _brandColor : _dividerC,
                            width: 1,
                          ),
                        ),
                        child: Text(
                          f,
                          style: _sf(
                            size: 12.5,
                            weight: FontWeight.w600,
                            color: selected ? _brandColor : _secondary,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: list.isEmpty
                    ? _emptyState()
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 80),
                        itemCount: list.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (_, i) =>
                            _AnnouncementCard(announcement: list[i]),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _brandColor.withValues(alpha: 0.08),
              ),
              child: Icon(Icons.campaign_outlined,
                  color: _brandColor, size: 28),
            ),
            const SizedBox(height: 14),
            Text('No announcements',
                style: _sf(size: 15, weight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(
              'New community posts will appear here automatically.',
              textAlign: TextAlign.center,
              style: _sf(size: 12.5, color: _secondary, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {

  final Announcement announcement;
  const _AnnouncementCard({required this.announcement});

  TextStyle _sf({
    double size = 15,
    FontWeight weight = FontWeight.w400,
    Color color = AppColors.textPrimary,
    double height = 1.35,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color,
      height: height,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? AppColors.midnightSurface : AppColors.surfaceLight;
    final textPrimary = isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
    final textSecondary = isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
    final textMuted = isDark ? AppColors.textMutedOnDark : AppColors.textMuted;
    final divider = isDark ? const Color(0xFF21262D) : AppColors.divider;
    final brandColor = isDark ? AppColors.primaryLight : AppColors.primary;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: divider, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (announcement.pinned) ...[
                Icon(Icons.push_pin_rounded, size: 14, color: brandColor),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  announcement.title,
                  style: _sf(size: 13.5, weight: FontWeight.w600, color: textPrimary),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: brandColor.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  announcement.category,
                  style: _sf(
                    size: 10.5,
                    weight: FontWeight.w700,
                    color: brandColor,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            announcement.body,
            style: _sf(size: 12.5, color: textSecondary, height: 1.4),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Icon(Icons.account_circle_outlined, size: 13, color: textMuted),
              const SizedBox(width: 4),
              Text(announcement.author, style: _sf(size: 11, color: textMuted)),
              const Spacer(),
              Text(
                DateFormat('MMM d • h:mm a').format(announcement.postedAt),
                style: _sf(size: 11, color: textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
