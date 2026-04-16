import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_container.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/shared_widgets.dart';

class MapScreen extends StatelessWidget {
  const MapScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      appBar: AppBar(
        title: const Text('Subdivision map'),
        actions: [
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.layers_outlined),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xl),
        child: Column(
          children: [
            // Search bar
            GlassContainer(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md, vertical: 6),
              borderRadius: AppRadius.pill,
              child: Row(
                children: [
                  const Icon(Icons.search,
                      color: AppColors.textMuted, size: 18),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: TextField(
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        color: AppColors.textPrimary,
                      ),
                      decoration: InputDecoration(
                        hintText: 'Search Phase, Block, or Lot',
                        hintStyle: GoogleFonts.inter(
                          color: AppColors.textMuted,
                          fontSize: 13,
                        ),
                        border: InputBorder.none,
                        filled: false,
                      ),
                    ),
                  ),
                  const Icon(Icons.mic_none,
                      color: AppColors.textMuted, size: 18),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            // Map placeholder (would integrate flutter_map / Leaflet tiles here)
            Expanded(
              child: GlassContainer(
                padding: EdgeInsets.zero,
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              AppColors.primaryLight.withOpacity(0.4),
                              AppColors.primaryDark.withOpacity(0.55),
                            ],
                          ),
                        ),
                        child: CustomPaint(painter: _GridPainter()),
                      ),
                    ),
                    // Mock pins
                    Positioned(
                      left: 80,
                      top: 120,
                      child: _IncidentPin(
                        color: AppColors.danger,
                        label: 'INC-0421',
                      ),
                    ),
                    Positioned(
                      right: 70,
                      top: 240,
                      child: _IncidentPin(
                        color: AppColors.warning,
                        label: 'INC-0418',
                      ),
                    ),
                    Positioned(
                      left: 140,
                      bottom: 180,
                      child: _IncidentPin(
                        color: AppColors.success,
                        label: 'Your pin',
                        pulse: true,
                      ),
                    ),
                    // Legend
                    Positioned(
                      left: AppSpacing.md,
                      bottom: AppSpacing.md,
                      right: AppSpacing.md,
                      child: _Legend(),
                    ),
                    // Zoom controls
                    Positioned(
                      top: AppSpacing.md,
                      right: AppSpacing.md,
                      child: Column(
                        children: [
                          GlassContainer(
                            width: 42,
                            height: 42,
                            padding: EdgeInsets.zero,
                            borderRadius: 14,
                            onTap: () {},
                            child: const Icon(Icons.add,
                                color: AppColors.textPrimary, size: 20),
                          ),
                          const SizedBox(height: 8),
                          GlassContainer(
                            width: 42,
                            height: 42,
                            padding: EdgeInsets.zero,
                            borderRadius: 14,
                            onTap: () {},
                            child: const Icon(Icons.remove,
                                color: AppColors.textPrimary, size: 20),
                          ),
                          const SizedBox(height: 8),
                          GlassContainer(
                            width: 42,
                            height: 42,
                            padding: EdgeInsets.zero,
                            borderRadius: 14,
                            onTap: () {},
                            child: const Icon(Icons.my_location,
                                color: AppColors.accent, size: 20),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            PrimaryButton(
              label: 'Drop pin on this location',
              icon: Icons.push_pin_outlined,
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}

class _IncidentPin extends StatelessWidget {
  final Color color;
  final String label;
  final bool pulse;
  const _IncidentPin(
      {required this.color, required this.label, this.pulse = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        GlassContainer(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm, vertical: 4),
          borderRadius: 10,
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ),
        const SizedBox(height: 4),
        Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color,
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: [
              BoxShadow(
                color: color.withOpacity(0.6),
                blurRadius: pulse ? 20 : 8,
                spreadRadius: pulse ? 4 : 1,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Legend extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return GlassContainer(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _legendDot(AppColors.danger, 'Critical'),
          _legendDot(AppColors.warning, 'Ongoing'),
          _legendDot(AppColors.success, 'Resolved'),
          _legendDot(AppColors.info, 'Patrol'),
        ],
      ),
    );
  }

  Widget _legendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(shape: BoxShape.circle, color: color),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 11,
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.06)
      ..strokeWidth = 1;
    const step = 40.0;
    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
    // Roads
    final road = Paint()
      ..color = Colors.white.withOpacity(0.12)
      ..strokeWidth = 12;
    canvas.drawLine(
        Offset(0, size.height * 0.45),
        Offset(size.width, size.height * 0.45),
        road);
    canvas.drawLine(
        Offset(size.width * 0.4, 0),
        Offset(size.width * 0.4, size.height),
        road);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
