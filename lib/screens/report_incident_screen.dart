import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:latlong2/latlong.dart';

import '../config/map_constants.dart';
import '../models/incident.dart';
import '../services/property_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/subdivision_map_picker.dart';

class ReportIncidentScreen extends StatefulWidget {
  const ReportIncidentScreen({super.key});

  @override
  State<ReportIncidentScreen> createState() => _ReportIncidentScreenState();
}

class _ReportIncidentScreenState extends State<ReportIncidentScreen>
    with SingleTickerProviderStateMixin {
  // ── Wizard state ───────────────────────────────────────────────────────────
  int _step = 0; // 0 = category, 1 = map, 2 = media/submit

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  String _category = 'Security';

  // ── Step 2 ─────────────────────────────────────────────────────────────────
  late LatLng _pin;
  final _descCtrl = TextEditingController();

  // ── Step 3 ─────────────────────────────────────────────────────────────────
  final List<String> _attachedMedia = []; // simulated file names
  bool _submitting = false;

  static const _categories = [
    _Category('Security', Icons.shield_rounded, Color(0xFF5C1D24)),
    _Category('Maintenance', Icons.build_rounded, Color(0xFF2563EB)),
    _Category('Medical', Icons.medical_services_rounded, Color(0xFFDC2626)),
    _Category('Hazard', Icons.warning_rounded, Color(0xFFF59E0B)),
    _Category('Fire', Icons.local_fire_department_rounded, Color(0xFFEA580C)),
    _Category('Noise', Icons.volume_up_rounded, Color(0xFF7C3AED)),
    _Category('Flooding', Icons.water_rounded, Color(0xFF0284C7)),
    _Category('Other', Icons.more_horiz_rounded, Color(0xFF6B7280)),
  ];

  @override
  void initState() {
    super.initState();
    _pin = MapConstants.subdivisionCenter;
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    super.dispose();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  void _next() {
    if (_step < 2) {
      setState(() => _step++);
    } else {
      _submit();
    }
  }

  void _back() {
    if (_step == 0) {
      Navigator.of(context).maybePop();
    } else {
      setState(() => _step--);
    }
  }

  Future<void> _submit() async {
    HapticFeedback.mediumImpact();
    setState(() => _submitting = true);
    await Future.delayed(const Duration(milliseconds: 1400));
    if (!mounted) return;
    setState(() => _submitting = false);
    _showSuccess();
  }

  void _showSuccess() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _SuccessSheet(
        category: _category,
        onDone: () {
          Navigator.of(context).pop();
          Navigator.of(context).pop();
        },
      ),
    );
  }

  Future<String> _lotLine() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return 'Not signed in';
    final prop = await PropertyStorage.loadForUser(user.uid);
    if (prop == null) return 'Complete property verification';
    return 'Phase ${prop.phase} • Block ${prop.block} • Lot ${prop.lot}';
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.midnightBase : const Color(0xFFF8F9FA);
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: Column(
          children: [
            // ── Wizard header ────────────────────────────────────────
            _WizardHeader(
              step: _step,
              onBack: _back,
              isDark: isDark,
              textPrimary: textPrimary,
            ),

            // ── Step body ────────────────────────────────────────────
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 340),
                switchInCurve: Curves.fastOutSlowIn,
                switchOutCurve: Curves.fastOutSlowIn,
                transitionBuilder: (child, anim) => SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0.05, 0),
                    end: Offset.zero,
                  ).animate(anim),
                  child: FadeTransition(opacity: anim, child: child),
                ),
                child: _buildStep(isDark, textPrimary),
              ),
            ),

            // ── Bottom CTA ───────────────────────────────────────────
            _WizardFooter(
              step: _step,
              onNext: _next,
              submitting: _submitting,
              canProceed: _step == 2
                  ? true
                  : (_step == 1
                      ? _descCtrl.text.isNotEmpty ||
                          true // map pin always set
                      : true),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStep(bool isDark, Color textPrimary) {
    switch (_step) {
      case 0:
        return _CategoryStep(
          key: const ValueKey('cat'),
          categories: _categories,
          selected: _category,
          isDark: isDark,
          textPrimary: textPrimary,
          onSelected: (c) => setState(() => _category = c),
        );
      case 1:
        return _MapStep(
          key: const ValueKey('map'),
          pin: _pin,
          descCtrl: _descCtrl,
          isDark: isDark,
          lotLineFuture: _lotLine(),
          onPinChanged: (ll) => setState(() => _pin = ll),
        );
      case 2:
        return _MediaStep(
          key: const ValueKey('media'),
          category: _category,
          pin: _pin,
          descCtrl: _descCtrl,
          attachedMedia: _attachedMedia,
          isDark: isDark,
          textPrimary: textPrimary,
          onAddPhoto: () => setState(() => _attachedMedia.add(
              'IMG_${DateTime.now().millisecondsSinceEpoch}.jpg')),
          onRemovePhoto: (i) =>
              setState(() => _attachedMedia.removeAt(i)),
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

// ── Wizard header ──────────────────────────────────────────────────────────────

class _WizardHeader extends StatelessWidget {
  final int step;
  final VoidCallback onBack;
  final bool isDark;
  final Color textPrimary;

  const _WizardHeader({
    required this.step,
    required this.onBack,
    required this.isDark,
    required this.textPrimary,
  });

  static const _titles = [
    'Select Category',
    'Pin Location',
    'Attach Evidence',
  ];
  static const _subtitles = [
    'What type of incident occurred?',
    'Drag the map to pin the exact location.',
    'Add photos and confirm details.',
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 24, 0),
          child: Row(
            children: [
              IconButton(
                onPressed: onBack,
                icon: Icon(Icons.arrow_back_ios_new_rounded,
                    color: textPrimary, size: 18),
              ),
              const Spacer(),
              Text(
                'Step ${step + 1} of 3',
                style: GoogleFonts.inter(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: isDark
                      ? AppColors.textSecondaryOnDark
                      : AppColors.textMuted,
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            child: LinearProgressIndicator(
              value: (step + 1) / 3,
              minHeight: 4,
              backgroundColor: isDark
                  ? AppColors.midnightSurfaceElevated
                  : const Color(0xFFE9ECEF),
              valueColor:
                  const AlwaysStoppedAnimation<Color>(AppColors.primary),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _titles[step],
                style: GoogleFonts.inter(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: textPrimary,
                  letterSpacing: -0.3,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _subtitles[step],
                style: GoogleFonts.inter(
                  fontSize: 13.5,
                  color: isDark
                      ? AppColors.textSecondaryOnDark
                      : AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ── Step 1: Category grid ──────────────────────────────────────────────────────

class _CategoryStep extends StatelessWidget {
  final List<_Category> categories;
  final String selected;
  final bool isDark;
  final Color textPrimary;
  final ValueChanged<String> onSelected;

  const _CategoryStep({
    super.key,
    required this.categories,
    required this.selected,
    required this.isDark,
    required this.textPrimary,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final cardBg = isDark ? AppColors.midnightSurfaceElevated : Colors.white;
    final border = isDark
        ? AppColors.innerStroke
        : const Color(0xFFE9ECEF);

    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 14,
        mainAxisSpacing: 14,
        childAspectRatio: 1.18,
      ),
      itemCount: categories.length,
      itemBuilder: (context, i) {
        final cat = categories[i];
        final isSelected = cat.label == selected;
        return GestureDetector(
          onTap: () {
            HapticFeedback.selectionClick();
            onSelected(cat.label);
          },
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.fastOutSlowIn,
            decoration: BoxDecoration(
              color: isSelected
                  ? cat.color.withOpacity(isDark ? 0.20 : 0.08)
                  : cardBg,
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(
                color: isSelected
                    ? cat.color.withOpacity(0.60)
                    : border,
                width: isSelected ? 2 : 1,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black
                      .withOpacity(isDark ? 0.36 : 0.04),
                  blurRadius: isDark ? 22 : 12,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: Stack(
              children: [
                Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: cat.color
                              .withOpacity(isDark ? 0.25 : 0.12),
                          borderRadius:
                              BorderRadius.circular(AppRadius.sm),
                        ),
                        child: Icon(cat.icon,
                            color: cat.color, size: 22),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        cat.label,
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: isSelected ? cat.color : textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                if (isSelected)
                  Positioned(
                    top: 12,
                    right: 12,
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: cat.color,
                      ),
                      child: const Icon(Icons.check_rounded,
                          color: Colors.white, size: 13),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

// ── Step 2: Map pinning ────────────────────────────────────────────────────────

class _MapStep extends StatelessWidget {
  final LatLng pin;
  final TextEditingController descCtrl;
  final bool isDark;
  final Future<String> lotLineFuture;
  final ValueChanged<LatLng> onPinChanged;

  const _MapStep({
    super.key,
    required this.pin,
    required this.descCtrl,
    required this.isDark,
    required this.lotLineFuture,
    required this.onPinChanged,
  });

  @override
  Widget build(BuildContext context) {
    final cardBg = isDark ? AppColors.midnightSurfaceElevated : Colors.white;
    final border =
        isDark ? AppColors.innerStroke : const Color(0xFFE9ECEF);
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;
    final textSecondary = isDark
        ? AppColors.textSecondaryOnDark
        : AppColors.textSecondary;

    return Column(
      children: [
        // Full-screen style map (takes majority of height)
        Expanded(
          flex: 5,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.lg),
              child: SubdivisionMapPicker(
                selected: pin,
                height: double.infinity,
                radarColor: AppColors.primary,
                radarLabel: 'INCIDENT',
                onChanged: onPinChanged,
              ),
            ),
          ),
        ),

        // Bottom detail panel
        Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Coordinates row
              Row(
                children: [
                  Icon(Icons.my_location_rounded,
                      size: 15, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Text(
                    '${pin.latitude.toStringAsFixed(5)}, '
                    '${pin.longitude.toStringAsFixed(5)}',
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: textPrimary,
                    ),
                  ),
                  const Spacer(),
                  FutureBuilder<String>(
                    future: lotLineFuture,
                    builder: (_, snap) => Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.08),
                        borderRadius:
                            BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(
                        snap.data ?? '…',
                        style: GoogleFonts.inter(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              // Description field
              TextField(
                controller: descCtrl,
                maxLines: 3,
                style: GoogleFonts.inter(
                    fontSize: 14, color: textPrimary),
                decoration: InputDecoration(
                  hintText:
                      'Describe what happened — be as specific as possible…',
                  hintStyle: GoogleFonts.inter(
                      fontSize: 13.5, color: AppColors.textMuted),
                  filled: true,
                  fillColor: isDark
                      ? AppColors.midnightInputFill
                      : const Color(0xFFF4F5F7),
                  contentPadding: const EdgeInsets.all(14),
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(AppRadius.md),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(AppRadius.md),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(AppRadius.md),
                    borderSide: const BorderSide(
                        color: AppColors.primary, width: 1.5),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}

// ── Step 3: Media & submit ─────────────────────────────────────────────────────

class _MediaStep extends StatelessWidget {
  final String category;
  final LatLng pin;
  final TextEditingController descCtrl;
  final List<String> attachedMedia;
  final bool isDark;
  final Color textPrimary;
  final VoidCallback onAddPhoto;
  final ValueChanged<int> onRemovePhoto;

  const _MediaStep({
    super.key,
    required this.category,
    required this.pin,
    required this.descCtrl,
    required this.attachedMedia,
    required this.isDark,
    required this.textPrimary,
    required this.onAddPhoto,
    required this.onRemovePhoto,
  });

  @override
  Widget build(BuildContext context) {
    final cardBg = isDark ? AppColors.midnightSurfaceElevated : Colors.white;
    final border =
        isDark ? AppColors.innerStroke : const Color(0xFFE9ECEF);
    final textSecondary = isDark
        ? AppColors.textSecondaryOnDark
        : AppColors.textSecondary;
    final timestamp =
        DateTime.now().toString().substring(0, 16).replaceAll('T', ' ');

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 4, 24, 16),
      children: [
        // ── Summary card ─────────────────────────────────────────────
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Report Summary',
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textMuted,
                  letterSpacing: 0.7,
                ),
              ),
              const SizedBox(height: 14),
              _SummaryRow(
                icon: Icons.category_rounded,
                label: 'Category',
                value: category,
                isDark: isDark,
              ),
              const SizedBox(height: 10),
              _SummaryRow(
                icon: Icons.location_on_rounded,
                label: 'Coordinates',
                value:
                    '${pin.latitude.toStringAsFixed(5)}, ${pin.longitude.toStringAsFixed(5)}',
                isDark: isDark,
              ),
              if (descCtrl.text.isNotEmpty) ...[
                const SizedBox(height: 10),
                _SummaryRow(
                  icon: Icons.notes_rounded,
                  label: 'Description',
                  value: descCtrl.text,
                  isDark: isDark,
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ── Forensic metadata watermark panel ───────────────────────
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.info.withOpacity(0.07),
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(
                color: AppColors.info.withOpacity(0.22)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.verified_rounded,
                  color: AppColors.info, size: 17),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Forensic Metadata Watermarking',
                      style: GoogleFonts.inter(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: isDark ? Colors.white : AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'All attached media will be automatically watermarked with timestamp ($timestamp), GPS coordinates, and device ID for evidentiary integrity.',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: textSecondary,
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // ── Media attachment ─────────────────────────────────────────
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.photo_library_outlined,
                      size: 16, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Text(
                    'Photo Evidence',
                    style: GoogleFonts.inter(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: textPrimary,
                    ),
                  ),
                  const Spacer(),
                  if (attachedMedia.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.success.withOpacity(0.12),
                        borderRadius:
                            BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Text(
                        '${attachedMedia.length} attached',
                        style: GoogleFonts.inter(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: AppColors.success,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 14),

              // Media grid
              if (attachedMedia.isNotEmpty) ...[
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate:
                      const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    childAspectRatio: 1,
                  ),
                  itemCount: attachedMedia.length,
                  itemBuilder: (_, i) => Stack(
                    fit: StackFit.expand,
                    children: [
                      ClipRRect(
                        borderRadius:
                            BorderRadius.circular(AppRadius.sm),
                        child: Container(
                          color: AppColors.primary.withOpacity(0.12),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.image_rounded,
                                  color: AppColors.primary, size: 26),
                              const SizedBox(height: 4),
                              Text(
                                'IMG',
                                style: GoogleFonts.inter(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.primary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        top: 4,
                        right: 4,
                        child: GestureDetector(
                          onTap: () => onRemovePhoto(i),
                          child: Container(
                            width: 20,
                            height: 20,
                            decoration: const BoxDecoration(
                              shape: BoxShape.circle,
                              color: AppColors.danger,
                            ),
                            child: const Icon(Icons.close_rounded,
                                color: Colors.white, size: 12),
                          ),
                        ),
                      ),
                      // Watermark badge
                      Positioned(
                        bottom: 0,
                        left: 0,
                        right: 0,
                        child: Container(
                          padding:
                              const EdgeInsets.symmetric(vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.55),
                            borderRadius: const BorderRadius.only(
                              bottomLeft: Radius.circular(AppRadius.sm),
                              bottomRight: Radius.circular(AppRadius.sm),
                            ),
                          ),
                          child: Center(
                            child: Text(
                              'Watermarked',
                              style: GoogleFonts.inter(
                                fontSize: 8.5,
                                fontWeight: FontWeight.w700,
                                color: Colors.white70,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],

              // Add photo button
              GestureDetector(
                onTap: onAddPhoto,
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    color: AppColors.primary.withOpacity(0.06),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: AppColors.primary.withOpacity(0.22),
                      width: 1.5,
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.add_a_photo_outlined,
                          color: AppColors.primary, size: 18),
                      const SizedBox(width: 10),
                      Text(
                        'Add Photo / Video',
                        style: GoogleFonts.inter(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool isDark;

  const _SummaryRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon,
            size: 15,
            color: isDark
                ? AppColors.textSecondaryOnDark
                : AppColors.textMuted),
        const SizedBox(width: 10),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
                letterSpacing: 0.4,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: GoogleFonts.inter(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: isDark ? Colors.white : AppColors.textPrimary,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// ── Wizard footer ──────────────────────────────────────────────────────────────

class _WizardFooter extends StatelessWidget {
  final int step;
  final VoidCallback onNext;
  final bool submitting;
  final bool canProceed;

  const _WizardFooter({
    required this.step,
    required this.onNext,
    required this.submitting,
    required this.canProceed,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final label = step == 2
        ? (submitting ? 'Submitting…' : 'Submit Report')
        : (step == 1 ? 'Continue to Evidence' : 'Continue to Map');
    final color = step == 2 ? AppColors.ctaGreen : AppColors.primary;

    return Padding(
      padding: EdgeInsets.fromLTRB(
          24, 12, 24, MediaQuery.of(context).padding.bottom + 20),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.md),
          boxShadow: canProceed && !submitting
              ? [
                  BoxShadow(
                    color: color.withOpacity(0.38),
                    blurRadius: 22,
                    offset: const Offset(0, 8),
                  ),
                ]
              : [],
        ),
        child: SizedBox(
          width: double.infinity,
          height: 54,
          child: ElevatedButton(
            onPressed: canProceed && !submitting ? onNext : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: color,
              disabledBackgroundColor: color.withOpacity(0.38),
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
            ),
            child: submitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.2, color: Colors.white),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        label,
                        style: GoogleFonts.inter(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(Icons.arrow_forward_rounded,
                          size: 18, color: Colors.white),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

// ── Success bottom sheet ───────────────────────────────────────────────────────

class _SuccessSheet extends StatelessWidget {
  final String category;
  final VoidCallback onDone;

  const _SuccessSheet({required this.category, required this.onDone});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.midnightSurface : Colors.white;
    final textPrimary = isDark ? Colors.white : AppColors.textPrimary;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadius.xl),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(isDark ? 0.50 : 0.14),
            blurRadius: 40,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.success.withOpacity(0.14),
              border: Border.all(
                  color: AppColors.success.withOpacity(0.40), width: 2),
            ),
            child: const Icon(Icons.check_rounded,
                color: AppColors.success, size: 36),
          ),
          const SizedBox(height: 18),
          Text(
            'Report Filed Successfully',
            style: GoogleFonts.inter(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: textPrimary,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Your $category report has been logged, timestamped, and routed to HOA security. You can track its status in My Incidents.',
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(
              fontSize: 13.5,
              color: isDark
                  ? AppColors.textSecondaryOnDark
                  : AppColors.textSecondary,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: onDone,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.ctaGreen,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
              ),
              child: Text(
                'Back to Dashboard',
                style: GoogleFonts.inter(
                    fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Data model ─────────────────────────────────────────────────────────────────

class _Category {
  final String label;
  final IconData icon;
  final Color color;
  const _Category(this.label, this.icon, this.color);
}
