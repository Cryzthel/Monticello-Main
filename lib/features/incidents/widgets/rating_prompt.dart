import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/dismiss_keyboard_on_tap.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';

/// Asks the resident to rate a resolved report's response, once.
///
/// ── DRIVEN BY THE DOCUMENT, NOT THE PUSH ────────────────────────────────────
/// The Guardhouse stamps `ratingRequestedAt` on the report when an officer
/// resolves it. This host watches the live incident list and opens the sheet
/// for the first report that [Incident.awaitsRating]. A push notification
/// cannot be relied on to get here (no device token, notifications off, the
/// app killed), and the document is always here.
///
/// Asked once per report. "Not now" is remembered on the device, and a
/// submitted rating comes back through the live listener as
/// `residentRatingStars`, which stops the question on every device.
///
/// Only recent calls: a report resolved weeks ago is history, and a rating
/// prompt for it on first launch after an update would be noise.
class RatingPromptHost extends StatefulWidget {
  const RatingPromptHost({super.key, required this.child});

  final Widget child;

  @override
  State<RatingPromptHost> createState() => _RatingPromptHostState();
}

const _dismissedKey = 'rating_prompt_dismissed';
const _promptWindow = Duration(days: 7);

class _RatingPromptHostState extends State<RatingPromptHost> {
  Set<String> _dismissed = {};
  bool _loaded = false;
  bool _showing = false;

  @override
  void initState() {
    super.initState();
    LocalDataStore.instance.addListener(_check);
    SharedPreferences.getInstance().then((prefs) {
      _dismissed = (prefs.getStringList(_dismissedKey) ?? const []).toSet();
      _loaded = true;
      _check();
    });
  }

  @override
  void dispose() {
    LocalDataStore.instance.removeListener(_check);
    super.dispose();
  }

  Future<void> _remember(String id) async {
    _dismissed.add(id);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_dismissedKey, _dismissed.toList());
  }

  void _check() {
    if (!_loaded || _showing || !mounted) return;
    final cutoff = DateTime.now().subtract(_promptWindow);
    Incident? due;
    for (final incident in LocalDataStore.instance.incidents) {
      if (incident.awaitsRating &&
          !_dismissed.contains(incident.id) &&
          incident.ratingRequestedAt!.isAfter(cutoff)) {
        due = incident;
        break;
      }
    }
    if (due == null) return;
    final incident = due;
    _showing = true;
    // After the frame: the listener fires during a snapshot, which can land
    // mid-build.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        _showing = false;
        return;
      }
      final rated = await showResponseRatingSheet(context, incident);
      await _remember(incident.id);
      _showing = false;
      if (!mounted) return;
      if (rated == true) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          const SnackBar(
              content: Text('Thank you. Your rating was sent to the HOA.')),
        );
      }
      _check();
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// The 1–5 star sheet. Resolves true when a rating was saved.
Future<bool?> showResponseRatingSheet(BuildContext context, Incident incident) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.backgroundSecondary,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
      side: BorderSide(color: AppColors.divider),
    ),
    builder: (_) =>
        DismissKeyboardOnTap(child: _RatingSheet(incident: incident)),
  );
}

const _starLabels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

class _RatingSheet extends StatefulWidget {
  const _RatingSheet({required this.incident});

  final Incident incident;

  @override
  State<_RatingSheet> createState() => _RatingSheetState();
}

class _RatingSheetState extends State<_RatingSheet> {
  int _stars = 0;
  bool _saving = false;
  String? _error;
  final _comment = TextEditingController();

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await LocalDataStore.instance.rateIncident(
        widget.incident.id,
        stars: _stars,
        comment: _comment.text,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error =
            'Could not send your rating. Check your connection and try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final incident = widget.incident;
    final reference =
        'INC-${incident.id.length >= 8 ? incident.id.substring(0, 8).toUpperCase() : incident.id.toUpperCase()}';
    final guard = incident.assignedGuardName.isNotEmpty
        ? incident.assignedGuardName
        : 'Security';

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
            20, 14, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.divider,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'How did security do?',
              style: sfPro(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary),
            ),
            const SizedBox(height: 4),
            Text(
              '$reference · ${incident.title.isNotEmpty ? incident.title : incident.category} · resolved by $guard',
              style: sfPro(fontSize: 13, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 18),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 1; i <= 5; i++)
                  Semantics(
                    button: true,
                    selected: _stars == i,
                    label: '$i star${i == 1 ? '' : 's'}, ${_starLabels[i - 1]}',
                    child: IconButton(
                      onPressed:
                          _saving ? null : () => setState(() => _stars = i),
                      iconSize: 36,
                      padding: const EdgeInsets.all(4),
                      icon: Icon(
                        i <= _stars
                            ? PhosphorIconsFill.star
                            : PhosphorIconsRegular.star,
                        color: i <= _stars
                            ? AppColors.warning
                            : AppColors.textMuted,
                      ),
                    ),
                  ),
              ],
            ),
            Center(
              child: Text(
                _stars == 0 ? 'Tap a star' : _starLabels[_stars - 1],
                style: sfPro(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color:
                      _stars == 0 ? AppColors.textMuted : AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _comment,
              enabled: !_saving,
              maxLength: 500,
              maxLines: 3,
              minLines: 2,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                hintText: 'Anything the HOA should know? (optional)',
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm)),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 4),
              Text(_error!,
                  style: sfPro(fontSize: 12.5, color: AppColors.danger)),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed:
                        _saving ? null : () => Navigator.of(context).pop(false),
                    child: Text(
                      'Not now',
                      style: sfPro(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed: _stars == 0 || _saving ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.background,
                        disabledBackgroundColor:
                            AppColors.primary.withValues(alpha: 0.4),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(AppRadius.pill)),
                      ),
                      child: Text(
                        _saving ? 'Sending…' : 'Submit rating',
                        style: sfPro(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: AppColors.background),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
