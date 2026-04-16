import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../models/incident.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_container.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/shared_widgets.dart';

class ReportIncidentScreen extends StatefulWidget {
  const ReportIncidentScreen({super.key});

  @override
  State<ReportIncidentScreen> createState() =>
      _ReportIncidentScreenState();
}

class _ReportIncidentScreenState extends State<ReportIncidentScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _category = 'Security';
  IncidentPriority _priority = IncidentPriority.medium;
  bool _attachMedia = false;
  bool _submitting = false;

  final _categories = const [
    ('Security', Icons.shield_outlined),
    ('Maintenance', Icons.build_outlined),
    ('Community', Icons.groups_outlined),
    ('Medical', Icons.medical_services_outlined),
    ('Fire', Icons.local_fire_department_outlined),
    ('Other', Icons.more_horiz),
  ];

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    await Future.delayed(const Duration(milliseconds: 1100));
    if (!mounted) return;
    setState(() => _submitting = false);
    _showSuccess();
  }

  void _showSuccess() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => GlassContainer(
        margin: const EdgeInsets.all(AppSpacing.md),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.success.withOpacity(0.2),
                border: Border.all(color: AppColors.success),
              ),
              child: const Icon(Icons.check_rounded,
                  color: AppColors.success, size: 36),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'Report filed successfully',
              style: GoogleFonts.inter(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Your incident has been logged and prioritized through the WPDA engine.',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.4,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            PrimaryButton(
              label: 'Back to dashboard',
              icon: Icons.dashboard_outlined,
              onPressed: () {
                Navigator.of(ctx).pop();
                Navigator.of(context).pop();
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      appBar: AppBar(
        title: const Text('Report an incident'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xxl),
        children: [
          // Location card (auto-filled from verified property)
          GlassContainer(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.info.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: AppColors.info.withOpacity(0.4)),
                  ),
                  child: const Icon(Icons.location_on_outlined,
                      color: AppColors.info),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Verified Location',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          color: AppColors.textMuted,
                          letterSpacing: 0.6,
                        ),
                      ),
                      Text(
                        'Phase 2 • Block 14 • Lot 07',
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                TextButton.icon(
                  onPressed: () =>
                      Navigator.of(context).pushNamed('/map'),
                  icon: const Icon(Icons.edit_location_alt_outlined, size: 16),
                  label: const Text('Pin'),
                  style: TextButton.styleFrom(
                      foregroundColor: AppColors.accent),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          const SectionHeader(
              title: 'Category', icon: Icons.category_outlined),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: _categories.map((c) {
              final selected = c.$1 == _category;
              return GestureDetector(
                onTap: () => setState(() => _category = c.$1),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md, vertical: 10),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.accent.withOpacity(0.22)
                        : Colors.white.withOpacity(0.06),
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    border: Border.all(
                      color: selected
                          ? AppColors.accent
                          : Colors.white.withOpacity(0.15),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(c.$2,
                          size: 14,
                          color: selected
                              ? AppColors.accent
                              : AppColors.textSecondary),
                      const SizedBox(width: 6),
                      Text(
                        c.$1,
                        style: GoogleFonts.inter(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: selected
                              ? AppColors.accent
                              : AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: AppSpacing.lg),
          GlassContainer(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                GlassTextField(
                  label: 'Title',
                  hint: 'Short summary of what happened',
                  icon: Icons.title,
                  controller: _titleCtrl,
                ),
                const SizedBox(height: AppSpacing.md),
                GlassTextField(
                  label: 'Description',
                  hint: 'Provide as much detail as possible',
                  icon: Icons.notes_outlined,
                  controller: _descCtrl,
                  maxLines: 5,
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          const SectionHeader(
              title: 'Priority', icon: Icons.priority_high_outlined),
          const SizedBox(height: AppSpacing.xs),
          GlassContainer(
            padding: const EdgeInsets.all(AppSpacing.sm),
            child: Row(
              children: IncidentPriority.values.map((p) {
                final selected = p == _priority;
                final color = IncidentPriorityInfo.color(p);
                return Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => _priority = p),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      margin: const EdgeInsets.all(3),
                      padding:
                          const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: selected
                            ? color.withOpacity(0.22)
                            : Colors.transparent,
                        borderRadius:
                            BorderRadius.circular(AppRadius.sm),
                        border: selected
                            ? Border.all(color: color)
                            : null,
                      ),
                      child: Column(
                        children: [
                          Icon(Icons.circle, size: 10, color: color),
                          const SizedBox(height: 4),
                          Text(
                            IncidentPriorityInfo.label(p),
                            style: GoogleFonts.inter(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: selected
                                  ? color
                                  : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          GlassContainer(
            padding: const EdgeInsets.all(AppSpacing.md),
            onTap: () =>
                setState(() => _attachMedia = !_attachMedia),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.accent.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: AppColors.accent.withOpacity(0.4)),
                  ),
                  child: const Icon(Icons.camera_alt_outlined,
                      color: AppColors.accent),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Attach photo / video',
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      Text(
                        _attachMedia
                            ? '1 file attached • forensic watermark applied'
                            : 'Evidence is auto-watermarked with timestamp + location',
                        style: GoogleFonts.inter(
                          fontSize: 11.5,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  _attachMedia
                      ? Icons.check_circle
                      : Icons.add_circle_outline,
                  color: _attachMedia
                      ? AppColors.success
                      : AppColors.textMuted,
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          PrimaryButton(
            label: 'Submit report',
            icon: Icons.send_rounded,
            loading: _submitting,
            onPressed: _submit,
          ),
          const SizedBox(height: AppSpacing.sm),
          GhostButton(
            label: 'Save draft',
            icon: Icons.save_outlined,
            onPressed: () {},
          ),
        ],
      ),
    );
  }
}
