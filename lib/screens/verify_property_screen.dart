import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/glass_container.dart';
import '../widgets/shared_widgets.dart';

/// "Verify-First" property registry — ties every account to a Phase/Block/Lot.
class VerifyPropertyScreen extends StatefulWidget {
  const VerifyPropertyScreen({super.key});

  @override
  State<VerifyPropertyScreen> createState() => _VerifyPropertyScreenState();
}

class _VerifyPropertyScreenState extends State<VerifyPropertyScreen> {
  String? _phase;
  String? _block;
  String? _lot;
  bool _loading = false;

  final _phases = const ['1', '2', '3', '4', '5'];
  final _blocks = const ['1', '2', '3', '4', '5', '6', '7', '8'];
  final _lots = const ['01', '02', '03', '04', '05', '06', '07', '08'];

  Future<void> _verify() async {
    if (_phase == null || _block == null || _lot == null) return;
    setState(() => _loading = true);
    await Future.delayed(const Duration(milliseconds: 1200));
    if (!mounted) return;
    setState(() => _loading = false);
    Navigator.of(context).pushReplacementNamed('/home');
  }

  @override
  Widget build(BuildContext context) {
    final canVerify = _phase != null && _block != null && _lot != null;

    return GradientScaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 18),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.md,
          AppSpacing.lg,
          AppSpacing.xl,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: 6,
              ),
              decoration: BoxDecoration(
                color: AppColors.accent.withOpacity(0.12),
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(color: AppColors.accent.withOpacity(0.4)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.verified_user_outlined,
                      color: AppColors.accent, size: 14),
                  const SizedBox(width: 6),
                  Text(
                    'VERIFY-FIRST REGISTRY',
                    style: GoogleFonts.inter(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: AppColors.accent,
                      letterSpacing: 1.2,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'Verify your property',
              style: GoogleFonts.inter(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Every report is tied to a registered location. Confirm your Phase, Block, and Lot to activate your account.',
              style: GoogleFonts.inter(
                fontSize: 14,
                color: AppColors.textSecondary,
                height: 1.5,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            GlassContainer(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _SelectTile(
                    label: 'Phase',
                    value: _phase,
                    options: _phases,
                    icon: Icons.map_outlined,
                    onSelected: (v) => setState(() => _phase = v),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _SelectTile(
                    label: 'Block',
                    value: _block,
                    options: _blocks,
                    icon: Icons.grid_view_outlined,
                    onSelected: (v) => setState(() => _block = v),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _SelectTile(
                    label: 'Lot',
                    value: _lot,
                    options: _lots,
                    icon: Icons.home_outlined,
                    onSelected: (v) => setState(() => _lot = v),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            GlassContainer(
              padding: const EdgeInsets.all(AppSpacing.md),
              tint: AppColors.info,
              child: Row(
                children: [
                  const Icon(Icons.info_outline,
                      color: AppColors.info, size: 18),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      'Your address will be cross-verified with the HOA master registry before activation.',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            PrimaryButton(
              label: 'Verify and continue',
              icon: Icons.verified_outlined,
              loading: _loading,
              onPressed: canVerify ? _verify : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectTile extends StatelessWidget {
  final String label;
  final String? value;
  final List<String> options;
  final IconData icon;
  final ValueChanged<String> onSelected;

  const _SelectTile({
    required this.label,
    required this.value,
    required this.options,
    required this.icon,
    required this.onSelected,
  });

  void _open(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) {
        return GlassContainer(
          margin: const EdgeInsets.all(AppSpacing.md),
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Select $label',
                style: GoogleFonts.inter(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: options.map((opt) {
                  final selected = opt == value;
                  return GestureDetector(
                    onTap: () {
                      onSelected(opt);
                      Navigator.pop(ctx);
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: selected
                            ? AppColors.accent.withOpacity(0.25)
                            : Colors.white.withOpacity(0.06),
                        borderRadius:
                            BorderRadius.circular(AppRadius.pill),
                        border: Border.all(
                          color: selected
                              ? AppColors.accent
                              : Colors.white.withOpacity(0.15),
                        ),
                      ),
                      child: Text(
                        opt,
                        style: GoogleFonts.inter(
                          color: selected
                              ? AppColors.accent
                              : AppColors.textPrimary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _open(context),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.06),
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: Colors.white.withOpacity(0.15)),
        ),
        child: Row(
          children: [
            Icon(icon, color: AppColors.textMuted, size: 20),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      color: AppColors.textMuted,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value ?? 'Select $label',
                    style: GoogleFonts.inter(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: value != null
                          ? AppColors.textPrimary
                          : AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.keyboard_arrow_down,
                color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}
