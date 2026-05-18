import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/property_storage.dart';
import '../services/user_profile_service.dart';

/// Phase / Block / Lot registry plus optional street & unit, with **view**
/// and **edit** layouts matching premium grouped-card patterns (compact
/// three-field row, account rows, verified banner).
///
/// Palette: Monticello maroon + white (light shell), plain background.
class PropertyDetailsScreen extends StatefulWidget {
  const PropertyDetailsScreen({super.key});

  @override
  State<PropertyDetailsScreen> createState() => _PropertyDetailsScreenState();
}

class _PropertyDetailsScreenState extends State<PropertyDetailsScreen> {
  static const _maroon = Color(0xFF7B1124);
  static const _success = Color(0xFF16A34A);
  bool get _isDark => Theme.of(context).brightness == Brightness.dark;
  Color get _bg => _isDark ? const Color(0xFF0F1218) : const Color(0xFFF7F7F8);
  Color get _textPrimary => _isDark ? const Color(0xFFF5F7FA) : const Color(0xFF111827);
  Color get _textSecondary => _isDark ? const Color(0xFFB3BDC8) : const Color(0xFF6B7280);
  Color get _textMuted => _isDark ? const Color(0xFF8D98A6) : const Color(0xFF9AA0A6);
  Color get _cardBorder => _isDark ? const Color(0xFF2A3140) : const Color(0xFFEFEFF1);
  Color get _card => _isDark ? const Color(0xFF171C24) : Colors.white;

  bool _loading = true;
  bool _editing = false;
  bool _saving = false;

  bool _verified = false;
  PropertyRecord? _saved;

  String? _phase;
  String? _block;
  String? _lot;
  late final TextEditingController _streetCtrl;
  late final TextEditingController _unitCtrl;

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

  @override
  void initState() {
    super.initState();
    _streetCtrl = TextEditingController();
    _unitCtrl = TextEditingController();
    _load();
  }

  @override
  void dispose() {
    _streetCtrl.dispose();
    _unitCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _verified = false;
        _saved = null;
      });
      return;
    }
    UserProfileService.instance.load();
    final v = await PropertyStorage.isVerifiedForUser(user.uid);
    final record = await PropertyStorage.loadFullForUser(user.uid);
    if (!mounted) return;
    setState(() {
      _verified = v;
      _saved = record;
      _phase = record?.phase;
      _block = record?.block;
      _lot = record?.lot;
      _streetCtrl.text = record?.street ?? '';
      _unitCtrl.text = record?.unit ?? '';
      _loading = false;
    });
  }

  void _enterEdit() {
    final r = _saved;
    if (r != null) {
      setState(() {
        _editing = true;
        _phase = r.phase;
        _block = r.block;
        _lot = r.lot;
        _streetCtrl.text = r.street;
        _unitCtrl.text = r.unit;
      });
    }
  }

  void _cancelEdit() {
    final r = _saved;
    setState(() {
      _editing = false;
      if (r != null) {
        _phase = r.phase;
        _block = r.block;
        _lot = r.lot;
        _streetCtrl.text = r.street;
        _unitCtrl.text = r.unit;
      }
    });
  }

  Future<void> _save() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    if (_phase == null || _block == null || _lot == null) {
      _toast('Choose phase, block, and lot.', isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      await PropertyStorage.saveVerifiedProperty(
        uid: user.uid,
        phase: _phase!,
        block: _block!,
        lot: _lot!,
        street: _streetCtrl.text,
        unit: _unitCtrl.text,
      );
      await _load();
      if (!mounted) return;
      setState(() {
        _editing = false;
        _saving = false;
      });
      _toast('Changes saved.');
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        _toast('Could not save.', isError: true);
      }
    }
  }

  void _toast(String msg, {bool isError = false}) {
    final m = ScaffoldMessenger.of(context);
    m.hideCurrentSnackBar();
    m.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isError ? const Color(0xFFEF4444) : _maroon,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        content: Text(msg,
            style: _sf(size: 14, weight: FontWeight.w500, color: Colors.white)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;

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
          'Property Details',
          style: _sf(size: 16, weight: FontWeight.w600),
        ),
        actions: [
          if (_verified && !_loading)
            if (_editing)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: TextButton(
                  onPressed: _saving ? null : _cancelEdit,
                  child: Text(
                    'Cancel',
                    style: _sf(
                        size: 14.5,
                        weight: FontWeight.w600,
                        color: _textSecondary),
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: TextButton.icon(
                  onPressed: _enterEdit,
                  icon:
                      const Icon(Icons.edit_outlined, color: _maroon, size: 18),
                  label: Text(
                    'Edit',
                    style: _sf(
                        size: 14.5, weight: FontWeight.w600, color: _maroon),
                  ),
                ),
              ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _maroon))
          : ListenableBuilder(
              listenable: UserProfileService.instance,
              builder: (context, _) {
                final email = user?.email ??
                    UserProfileService.instance.profile?.email ??
                    '';
                final displayName = UserProfileService.instance.profile?.name
                            .trim()
                            .isNotEmpty ==
                        true
                    ? UserProfileService.instance.profile!.name.trim()
                    : (user?.displayName?.trim().isNotEmpty == true
                        ? user!.displayName!.trim()
                        : '');

                return RefreshIndicator(
                  color: _maroon,
                  onRefresh: _load,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 6, 20, 36),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (!_verified || _saved == null) ...[
                          _unverifiedBanner(),
                          const SizedBox(height: 20),
                          _sectionTitle('PROPERTY LOCATION'),
                          _verifyNeededCard(context),
                          const SizedBox(height: 24),
                          _sectionTitle('ACCOUNT DETAILS'),
                          _accountCard(
                            email: email,
                            displayName: displayName,
                          ),
                        ] else ...[
                          _verifiedBanner(),
                          const SizedBox(height: 22),
                          _sectionTitle('PROPERTY LOCATION'),
                          if (_editing) ...[
                            _editLocationBody(),
                          ] else ...[
                            _viewLocationCard(_saved!),
                          ],
                          if (_editing) ...[
                            const SizedBox(height: 16),
                            _saveChangesButton(),
                          ],
                          const SizedBox(height: 24),
                          _sectionTitle('ACCOUNT DETAILS'),
                          _accountCard(
                            email: email.isNotEmpty ? email : '—',
                            displayName:
                                displayName.isNotEmpty ? displayName : '—',
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }

  Widget _verifiedBanner() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _cardBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _iconSquare(Icons.verified_rounded, _success,
              iconColor: Colors.white),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Verified Resident',
                  style: _sf(size: 16, weight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  'Your property ownership is confirmed.',
                  style: _sf(size: 13.5, color: _textSecondary, height: 1.45),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    _miniBadge(
                        Icons.check_circle_rounded, 'Verified', _success),
                    _miniBadge(
                      Icons.home_work_outlined,
                      'Ph ${_saved!.phase} · Blk ${_saved!.block} · Lot ${_saved!.lot}',
                      _maroon,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _miniBadge(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: _sf(size: 11, weight: FontWeight.w600, color: color),
          ),
        ],
      ),
    );
  }

  Widget _unverifiedBanner() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _isDark ? const Color(0xFF2A1E1E) : const Color(0xFFFFF8F8),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _maroon.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          _iconSquare(
              Icons.location_searching_rounded, const Color(0xFFF59E0B)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Verification required',
                  style: _sf(size: 16, weight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  'Register Phase, Block, and Lot before filing reports.',
                  style: _sf(size: 13.5, color: _textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _verifyNeededCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _maroon.withValues(alpha: 0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'No property linked yet.',
            style: _sf(size: 14.5, weight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            'Finish the HOA registry wizard to activate your dashboard.',
            style: _sf(size: 13.5, color: _textSecondary, height: 1.45),
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () async {
              await Navigator.of(context).pushNamed('/verify');
              if (!context.mounted) return;
              await _load();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: _maroon,
              foregroundColor: Colors.white,
              elevation: 0,
              minimumSize: const Size.fromHeight(50),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: Text(
              'Verify property',
              style:
                  _sf(size: 15, weight: FontWeight.w600, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String label) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Text(
        label,
        style: _sf(
          size: 11,
          weight: FontWeight.w700,
          color: _maroon.withValues(alpha: 0.82),
          letterSpacing: 1.05,
        ),
      ),
    );
  }

  Widget _viewLocationCard(PropertyRecord r) {
    return Container(
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _cardBorder),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child:
                      _tripleFieldTile('Phase', r.phase, Icons.layers_outlined),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _tripleFieldTile(
                      'Block', r.block, Icons.grid_view_rounded),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _tripleFieldTile('Lot', r.lot, Icons.home_outlined),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          _valueRow(Icons.signpost_rounded, 'Street / Road',
              r.street.trim().isEmpty ? 'Not set (optional)' : r.street,
              muted: r.street.trim().isEmpty),
          const Divider(height: 1),
          _valueRow(Icons.door_front_door_rounded, 'Unit / House No.',
              r.unit.trim().isEmpty ? 'Not set (optional)' : r.unit,
              muted: r.unit.trim().isEmpty),
        ],
      ),
    );
  }

  Widget _tripleFieldTile(String label, String value, IconData icon) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      decoration: BoxDecoration(
        color: _maroon.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _maroon.withValues(alpha: 0.12)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: _maroon.withValues(alpha: 0.7)),
              const SizedBox(width: 5),
              Text(
                label,
                style: _sf(
                    size: 10.5,
                    weight: FontWeight.w700,
                    color: _maroon.withValues(alpha: 0.7)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Center(
            child: Text(
              value,
              textAlign: TextAlign.center,
              style: _sf(size: 18, weight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  Widget _valueRow(IconData icon, String label, String value,
      {bool muted = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          _iconSquare(icon, _textSecondary.withValues(alpha: 0.5), size: 36),
          const SizedBox(width: 14),
          Expanded(
            flex: 2,
            child: Text(label, style: _sf(size: 14, weight: FontWeight.w500)),
          ),
          Expanded(
            flex: 3,
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: _sf(
                  size: 14,
                  weight: FontWeight.w600,
                  color: muted ? _textMuted : _textPrimary),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }

  Widget _accountCard({required String email, required String displayName}) {
    return Container(
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _cardBorder),
      ),
      child: Column(
        children: [
          _denseRow(
              Icons.email_outlined, const Color(0xFF6366F1), 'Email', email),
          const Divider(height: 1),
          _denseRow(Icons.person_outline_rounded, _maroon, 'Display name',
              displayName),
        ],
      ),
    );
  }

  Widget _denseRow(IconData icon, Color iconBg, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      child: Row(
        children: [
          _iconSquare(icon, iconBg, size: 36),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: Text(label, style: _sf(size: 14, weight: FontWeight.w500)),
          ),
          Expanded(
            flex: 3,
            child: Text(
              value.isEmpty ? '—' : value,
              textAlign: TextAlign.end,
              style: _sf(size: 13.5, weight: FontWeight.w600),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _iconSquare(IconData icon, Color tint,
      {bool light = false, double size = 42, Color? iconColor}) {
    final bool solid = iconColor != null;
    final Color bg = solid ? tint : tint.withValues(alpha: light ? 0.14 : 0.18);
    final Color fg = iconColor ?? tint;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(size > 38 ? 10 : 8),
      ),
      child: Icon(icon, color: fg, size: size * 0.45),
    );
  }

  Widget _editLocationBody() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Phase',
              style: _sf(size: 12, weight: FontWeight.w700, color: _textMuted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ..._buildPillWrap(_phases, _phase,
                  onSelected: (v) => setState(() => _phase = v)),
            ],
          ),
          const SizedBox(height: 14),
          Text('Block',
              style: _sf(size: 12, weight: FontWeight.w700, color: _textMuted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ..._buildPillWrap(_blocks, _block,
                  onSelected: (v) => setState(() => _block = v)),
            ],
          ),
          const SizedBox(height: 14),
          Text('Lot',
              style: _sf(size: 12, weight: FontWeight.w700, color: _textMuted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ..._buildPillWrap(_lots, _lot,
                  onSelected: (v) => setState(() => _lot = v)),
            ],
          ),
          const SizedBox(height: 18),
          _labeledField(
            hint: 'e.g. Main Street',
            controller: _streetCtrl,
            label: 'Street / Road (optional)',
            icon: Icons.signpost_rounded,
          ),
          const SizedBox(height: 14),
          _labeledField(
            hint: 'e.g. 12 · Unit B',
            controller: _unitCtrl,
            label: 'Unit / House No. (optional)',
            icon: Icons.door_front_door_rounded,
          ),
        ],
      ),
    );
  }

  List<Widget> _buildPillWrap(List<String> opts, String? sel,
      {required void Function(String) onSelected}) {
    return opts
        .map((opt) => _pill(opt, sel == opt, () => onSelected(opt)))
        .toList();
  }

  Widget _pill(String label, bool selected, VoidCallback onTap) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? _maroon : _card,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? _maroon : _cardBorder),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: _maroon.withValues(alpha: 0.16),
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ]
                : null,
          ),
          child: Text(
            label,
            style: _sf(
              size: 13.5,
              weight: FontWeight.w600,
              color: selected ? Colors.white : _textPrimary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _labeledField({
    required String label,
    required TextEditingController controller,
    required String hint,
    required IconData icon,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: _sf(size: 12, weight: FontWeight.w700, color: _textMuted)),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          style: _sf(size: 15),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: _sf(size: 14, color: _textMuted),
            filled: true,
            fillColor: _isDark ? const Color(0xFF131924) : const Color(0xFFF9FAFB),
            prefixIcon: Icon(icon, color: _textMuted.withValues(alpha: 0.7)),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 14,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: _cardBorder),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: _maroon, width: 1.35),
            ),
          ),
        ),
      ],
    );
  }

  Widget _saveChangesButton() {
    return ElevatedButton.icon(
      onPressed: _saving ? null : _save,
      style: ElevatedButton.styleFrom(
        backgroundColor: _maroon,
        foregroundColor: Colors.white,
        disabledBackgroundColor: _maroon.withValues(alpha: 0.35),
        elevation: 0,
        minimumSize: const Size.fromHeight(54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      icon: _saving
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                  strokeWidth: 2.2, color: Colors.white),
            )
          : const Icon(Icons.save_rounded, size: 20),
      label: Text(
        _saving ? 'Saving…' : 'Save changes',
        style: _sf(size: 15, weight: FontWeight.w600, color: Colors.white),
      ),
    );
  }
}
