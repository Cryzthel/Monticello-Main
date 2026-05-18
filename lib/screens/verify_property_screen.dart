import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/property_storage.dart';
import '../theme/app_theme.dart';

/// Verify-First property registry — ties every account to a Phase/Block/Lot.
/// Plain white, modern iOS-style design that mirrors the auth & home screens.
class VerifyPropertyScreen extends StatefulWidget {
  const VerifyPropertyScreen({super.key});

  @override
  State<VerifyPropertyScreen> createState() => _VerifyPropertyScreenState();
}

class _VerifyPropertyScreenState extends State<VerifyPropertyScreen> {
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _bg => _isDark ? AppColors.midnightBase : AppColors.bgLight;
  Color get _textPrimary => _isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
  Color get _textSecondary => _isDark ? AppColors.textSecondaryOnDark : AppColors.textSecondary;
  Color get _textMuted => _isDark ? AppColors.textMutedOnDark : AppColors.textMuted;
  Color get _fieldBorder => _isDark ? AppColors.innerStroke : AppColors.divider;
  Color get _fieldFill => _isDark ? AppColors.midnightInputFill : AppColors.bgLight;
  Color get _brandColor => _isDark ? AppColors.primaryLight : AppColors.primary;

  String? _phase;
  String? _block;
  String? _lot;
  bool _loading = false;

  final _phases = const ['1', '2', '3', '4', '5'];
  final _blocks = const ['1', '2', '3', '4', '5', '6', '7', '8'];
  final _lots = const ['01', '02', '03', '04', '05', '06', '07', '08'];

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
      color: color ?? _textPrimary,
      letterSpacing: letterSpacing,
      height: height,
    );
  }

  void _showToast(String message, {bool isError = false}) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isError ? AppColors.danger : AppColors.success,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
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

  Future<void> _verify() async {
    if (_phase == null || _block == null || _lot == null) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!mounted) return;
      Navigator.of(context).pushNamedAndRemoveUntil('/login', (_) => false);
      return;
    }

    setState(() => _loading = true);
    try {
      await PropertyStorage.saveVerifiedProperty(
        uid: user.uid,
        phase: _phase!,
        block: _block!,
        lot: _lot!,
      );
      if (!mounted) return;
      _showToast('Property verified.');
      await Future.delayed(const Duration(milliseconds: 250));
      if (!mounted) return;
      if (Navigator.of(context).canPop()) {
        Navigator.of(context).pop(true);
      } else {
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } catch (_) {
      if (mounted) _showToast('Could not save property.', isError: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canVerify = _phase != null && _block != null && _lot != null;
    final summary = canVerify
        ? 'Phase $_phase  •  Block $_block  •  Lot $_lot'
        : 'Pick a phase, block, and lot to continue';

    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded,
              color: _textPrimary, size: 18),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        centerTitle: true,
        title: Text(
          'Verify property',
          style: _sf(size: 16, weight: FontWeight.w600, color: _textPrimary),
        ),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _eyebrow(),
              const SizedBox(height: 14),
              RichText(
                text: TextSpan(
                  style: _sf(
                    size: 26,
                    weight: FontWeight.w700,
                    color: _textPrimary,
                    letterSpacing: -0.4,
                    height: 1.2,
                  ),
                  children: [
                    const TextSpan(text: 'Verify your '),
                    TextSpan(
                      text: 'property',
                      style: _sf(
                        size: 26,
                        weight: FontWeight.w700,
                        color: _brandColor,
                        letterSpacing: -0.4,
                        height: 1.2,
                      ),
                    ),
                    const TextSpan(text: '.'),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Every report is tied to a registered location. Confirm your Phase, Block, and Lot to activate your account.',
                style: _sf(size: 13.5, color: _textSecondary, height: 1.5),
              ),
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: _isDark ? AppColors.midnightSurface : AppColors.surfaceLight,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: _fieldBorder),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Property Location',
                        style: _sf(
                          size: 12,
                          weight: FontWeight.w700,
                          color: _textMuted,
                          letterSpacing: 0.8,
                        )),
                    const SizedBox(height: 10),
                    Text('Phase',
                        style: _sf(
                          size: 12,
                          weight: FontWeight.w700,
                          color: _textMuted,
                        )),
                    const SizedBox(height: 8),
                    _PillChipWrap(
                      options: _phases,
                      value: _phase,
                      onSelected: (v) => setState(() => _phase = v),
                    ),
                    const SizedBox(height: 14),
                    Text('Block',
                        style: _sf(
                          size: 12,
                          weight: FontWeight.w700,
                          color: _textMuted,
                        )),
                    const SizedBox(height: 8),
                    _PillChipWrap(
                      options: _blocks,
                      value: _block,
                      onSelected: (v) => setState(() => _block = v),
                    ),
                    const SizedBox(height: 14),
                    Text('Lot',
                        style: _sf(
                          size: 12,
                          weight: FontWeight.w700,
                          color: _textMuted,
                        )),
                    const SizedBox(height: 8),
                    _PillChipWrap(
                      options: _lots,
                      value: _lot,
                      onSelected: (v) => setState(() => _lot = v),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              _summaryCard(summary, canVerify: canVerify),
              const SizedBox(height: 14),
              _infoBanner(),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 54,
                child: ElevatedButton.icon(
                  onPressed: canVerify && !_loading ? _verify : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _brandColor,
                    disabledBackgroundColor: _brandColor.withValues(alpha: 0.35),
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  icon: _loading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2.2,
                          ),
                        )
                      : const Icon(Icons.verified_outlined, size: 18),
                  label: Text(
                    _loading ? 'Verifying…' : 'Verify and continue',
                    style: _sf(
                      size: 15,
                      weight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _eyebrow() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _brandColor.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: _brandColor.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.verified_user_outlined, color: _brandColor, size: 13),
          const SizedBox(width: 6),
          Text(
            'VERIFY-FIRST REGISTRY',
            style: _sf(
              size: 10.5,
              weight: FontWeight.w700,
              color: _brandColor,
              letterSpacing: 1.2,
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryCard(String text, {required bool canVerify}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: canVerify ? _brandColor.withValues(alpha: 0.06) : _fieldFill,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: canVerify ? _brandColor.withValues(alpha: 0.25) : _fieldBorder,
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Icon(
            canVerify
                ? Icons.location_on_rounded
                : Icons.location_searching_rounded,
            size: 18,
            color: canVerify ? _brandColor : _textMuted,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: _sf(
                size: 13,
                weight: FontWeight.w600,
                color: canVerify ? _textPrimary : _textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoBanner() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.info.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.info.withValues(alpha: 0.2)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, color: AppColors.info, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Your address will be cross-verified with the HOA master registry before activation.',
              style: _sf(
                size: 12.5,
                color: _textSecondary,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PillChipWrap extends StatelessWidget {
  final List<String> options;
  final String? value;
  final ValueChanged<String> onSelected;

  const _PillChipWrap({
    required this.options,
    required this.value,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final brand = isDark ? AppColors.primaryLight : AppColors.primary;
    final textColor = isDark ? AppColors.textPrimaryOnDark : AppColors.textPrimary;
    final borderColor = isDark ? AppColors.innerStroke : AppColors.divider;
    final chipBg = isDark ? AppColors.midnightSurface : Colors.white;

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: options.map((opt) {
        final selected = opt == value;
        return GestureDetector(
          onTap: () => onSelected(opt),
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            constraints: const BoxConstraints(minWidth: 56),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: selected ? brand : chipBg,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected ? brand : borderColor,
                width: 1,
              ),
              boxShadow: selected
                  ? [
                      BoxShadow(
                        color: brand.withValues(alpha: 0.18),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ]
                  : null,
            ),
            child: Center(
              child: Text(
                opt,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: selected ? Colors.white : textColor,
                  height: 1,
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}
