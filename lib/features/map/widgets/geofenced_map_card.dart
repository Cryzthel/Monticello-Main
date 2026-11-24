import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:latlong2/latlong.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

// ═══════════════════════════════════════════════════════════════════════════
// GeofencedMapCard  (Homepage — VIEW ONLY)
//
// The home map is for viewing the Monticello Villas premises and showing the
// resident's *own current location* (GPS). It deliberately does NOT let the
// user pin or select an arbitrary location — manual pin-dropping lives in the
// Incident Report flow instead. The map stays focused on the village (the view
// is clamped to the geofence), and the resident's live position is shown when
// they are inside the premises.
// ═══════════════════════════════════════════════════════════════════════════

TextStyle _t({
  double size = 14,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.textPrimary,
  double height = 1.3,
  double spacing = 0,
}) =>
    sfPro(
      fontSize: size,
      fontWeight: weight,
      color: color,
      height: height,
      letterSpacing: spacing,
    );

class GeofencedMapCard extends StatefulWidget {
  const GeofencedMapCard({
    super.key,
    this.height = 320,
    this.showReadout = true,
    this.rounded = true,
    this.compactStatusChip = false,
  });

  /// Height of the map canvas (the readout sits below it). Ignored when
  /// [showReadout] is false — in that mode the map fills whatever space its
  /// parent gives it (e.g. a `Positioned.fill` inside a `Stack`), which is
  /// how the homepage uses this as a full-bleed background layer.
  final double height;

  /// Whether to render the live-location status card below the map. Off for
  /// the homepage's Life360-style background layer, where the map itself is
  /// the whole point and a detailed readout would just sit hidden behind the
  /// overlapping announcements panel.
  final bool showReadout;

  /// Whether the map canvas gets its own rounded-corner clip. Off when used
  /// as an edge-to-edge background layer.
  final bool rounded;

  /// Configuration hook for re-enabling the live-location status without
  /// the full readout card: when true, shows a compact pill chip (status
  /// color + icon + short label) floating over the map instead. Off by
  /// default — flip it on whenever the status needs to come back.
  final bool compactStatusChip;

  @override
  State<GeofencedMapCard> createState() => _GeofencedMapCardState();
}

enum _LiveLocationStatus { locating, live, outside, unavailable }

class _GeofencedMapCardState extends State<GeofencedMapCard> {
  final MapController _map = MapController();

  LatLng? _currentLocation;
  _LiveLocationStatus _status = _LiveLocationStatus.locating;
  bool _satellite = false;

  bool get _inside => _status == _LiveLocationStatus.live;

  @override
  void initState() {
    super.initState();
    _locate();
  }

  @override
  void dispose() {
    _map.dispose();
    super.dispose();
  }

  // ── Resolve the resident's current GPS position ─────────────────────────────
  Future<void> _locate() async {
    if (mounted) {
      setState(() => _status = _LiveLocationStatus.locating);
    }
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _setUnavailable();
        return;
      }

      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        _setUnavailable();
        return;
      }

      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      if (!mounted) return;
      final loc = LatLng(pos.latitude, pos.longitude);
      final inside = MapConstants.containsInSubdivision(loc);
      setState(() {
        _currentLocation = loc;
        _status =
            inside ? _LiveLocationStatus.live : _LiveLocationStatus.outside;
      });
      if (inside) {
        _map.move(loc, MapConstants.plotZoom);
      }
    } catch (_) {
      _setUnavailable();
    }
  }

  /// No real GPS fix could be resolved (denied / off / error). The map keeps
  /// framing the village itself — it never fabricates a placeholder pin.
  void _setUnavailable() {
    if (!mounted) return;
    setState(() {
      _currentLocation = null;
      _status = _LiveLocationStatus.unavailable;
    });
  }

  void _recenter() {
    HapticFeedback.selectionClick();
    if (_status == _LiveLocationStatus.live) {
      _map.move(_currentLocation!, MapConstants.plotZoom);
    } else {
      _map.move(MapConstants.propertyPlotCenter, MapConstants.plotZoom);
      _locate();
    }
  }

  /// Up-to-two-letter initials from the profile name (falls back to the email,
  /// then 'M') — used when the resident has no profile photo.
  String _initialsFor(UserProfile? p) {
    final name = (p?.name ?? '').trim();
    if (name.isNotEmpty) {
      final parts = name.split(RegExp(r'\s+'));
      if (parts.length >= 2 && parts[1].isNotEmpty) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return name.substring(0, 1).toUpperCase();
    }
    final email = (p?.email ?? '').trim();
    if (email.isNotEmpty) return email.substring(0, 1).toUpperCase();
    return 'M';
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final map = widget.rounded
        ? ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.xl),
            child: _buildMapStack(),
          )
        : _buildMapStack();

    if (!widget.showReadout) {
      // Full-bleed background usage (Life360-style homepage layer) — fills
      // whatever box its parent gives it, whether that's a `Positioned.fill`
      // inside a `Stack` or an `Expanded` inside a `Column`.
      return SizedBox.expand(child: map);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(height: widget.height, width: double.infinity, child: map),
        const SizedBox(height: 12),
        _buildReadout(),
      ],
    );
  }

  /// Horizontal gutter for the floating chip/controls — mirrors the
  /// responsive inset the dashboard header uses, so the map's overlay
  /// elements line up with the header and sheet content above/below it
  /// instead of hugging the raw screen edge on wide layouts.
  double _hPad(BuildContext context) =>
      MediaQuery.of(context).size.width >= 600 ? 28.0 : 20.0;

  Widget _buildMapStack() {
    return Stack(
      children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: MapConstants.propertyPlotCenter,
            initialZoom: MapConstants.plotZoom,
            // NO minZoom/maxZoom — pinch freely in both directions. The
            // geofence below still holds the CENTRE inside the village; that
            // is the constraint this card actually needs, and capping zoom was
            // never doing that job.
            // View only: pan + pinch-zoom to look around, but no taps to
            // drop pins. The view is kept within the geofence.
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
            ),
            onPositionChanged: (position, hasGesture) {
              final c = position.center;
              if (c == null) return;
              if (MapConstants.containsInSubdivision(c)) return;
              _map.move(MapConstants.clampToSubdivision(c),
                  position.zoom ?? MapConstants.plotZoom);
            },
          ),
          children: [
            TileLayer(
              urlTemplate: _satellite
                  ? MapConstants.satelliteTileUrl
                  : MapConstants.tileUrl,
              userAgentPackageName: 'com.monticello_villas_app',
              // maxNativeZoom, NOT maxZoom — see subdivision_map_picker.
              maxNativeZoom: 19,
            ),
            // Geofence boundary (the village perimeter). Line only, emerald,
            // 2px — the same stroke all four maps draw.
            PolygonLayer(
              polygons: [
                Polygon(
                  points: MapConstants.subdivisionBoundary,
                  color: Colors.transparent,
                  borderColor: AppColors.accentPrimary,
                  borderStrokeWidth: 2,
                ),
              ],
            ),
            // Resident's current location, shown as their avatar marker
            // (only when inside the premises).
            if (_inside)
              MarkerLayer(
                markers: [
                  Marker(
                    width: 60,
                    height: 70,
                    point: _currentLocation!,
                    // Anchor the pin's tail tip (bottom) on the exact point.
                    alignment: Alignment.bottomCenter,
                    // View-only: no tap handler, so the marker can't open
                    // the profile/edit menu from the map.
                    child: ListenableBuilder(
                      listenable: UserProfileService.instance,
                      builder: (context, _) {
                        final profile = UserProfileService.instance.profile;
                        return _AvatarMarker(
                          photoUrl: profile?.photoUrl ?? '',
                          initials: _initialsFor(profile),
                        );
                      },
                    ),
                  ),
                ],
              ),
          ],
        ),

        // Floating overlay layer — boundary chip (top-left) and map controls
        // (top/bottom-right) are kept inside the same centered, max-width
        // column the header and announcement sheet use, so they read as one
        // organized dashboard instead of edge-pinned afterthoughts.
        Positioned.fill(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: _hPad(context)),
                child: Stack(
                  children: [
                    Positioned(
                      left: 0,
                      top: 12,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _glassChip(
                            icon: PhosphorIconsFill.shieldCheck,
                            label: 'Monticello Villas premises',
                          ),
                          if (widget.compactStatusChip) ...[
                            const SizedBox(height: 8),
                            _statusChip(),
                          ],
                        ],
                      ),
                    ),
                    Positioned(
                      right: 0,
                      top: widget.showReadout ? null : 12,
                      bottom: widget.showReadout ? 12 : null,
                      child: Column(
                        children: [
                          _mapButton(
                            icon: _satellite
                                ? PhosphorIconsFill.mapTrifold
                                : PhosphorIconsFill.planet,
                            tooltip: _satellite ? 'Street view' : 'Satellite view',
                            onTap: () => setState(() => _satellite = !_satellite),
                          ),
                          const SizedBox(height: 8),
                          _mapButton(
                            icon: PhosphorIconsFill.navigationArrow,
                            tooltip: 'Center on my location',
                            onTap: _recenter,
                            accent: true,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Frosted glass chip — sits directly over the map tiles, so a real
  /// backdrop blur has a visible effect (unlike panels over the flat
  /// gradient shell elsewhere).
  Widget _glassChip({required IconData icon, required String label}) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.backgroundSecondary.withValues(alpha: 0.75),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppColors.glassBorderLight),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: AppColors.primary),
              const SizedBox(width: 6),
              Text(label,
                  style: _t(
                      size: 11.5,
                      weight: FontWeight.w600,
                      color: AppColors.textPrimary)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _mapButton({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
    bool accent = false,
  }) {
    return Tooltip(
      message: tooltip,
      child: ClipOval(
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
          child: Material(
            color: AppColors.backgroundSecondary.withValues(alpha: 0.75),
            shape: const CircleBorder(
              side: BorderSide(color: AppColors.glassBorderLight),
            ),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onTap,
              child: SizedBox(
                width: 42,
                height: 42,
                child: Icon(icon,
                    size: 19,
                    color: accent ? AppColors.primary : AppColors.textPrimary),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Color/icon/label for the current GPS status — shared by the full
  /// readout card and the compact floating chip so both stay in sync.
  (Color, IconData, String) _statusVisuals() {
    switch (_status) {
      case _LiveLocationStatus.locating:
        return (AppColors.textMuted, PhosphorIconsFill.crosshairSimple,
            'Locating…');
      case _LiveLocationStatus.live:
        return (AppColors.success, PhosphorIconsFill.checkCircle,
            'Inside premises');
      case _LiveLocationStatus.outside:
        return (AppColors.info, PhosphorIconsFill.mapPinSimple,
            'Outside premises');
      case _LiveLocationStatus.unavailable:
        return (
          AppColors.textMuted,
          PhosphorIconsFill.gpsSlash,
          'Unavailable'
        );
    }
  }

  /// Compact pill chip alternative to the full readout card — status color,
  /// icon, and short label only, no coordinates. Toggled via
  /// [GeofencedMapCard.compactStatusChip].
  Widget _statusChip() {
    final (color, icon, label) = _statusVisuals();
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.backgroundSecondary.withValues(alpha: 0.75),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppColors.glassBorderLight),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 13, color: color),
              const SizedBox(width: 6),
              Text(label,
                  style: _t(size: 11, weight: FontWeight.w700, color: color)),
            ],
          ),
        ),
      ),
    );
  }

  // ── Live status / coordinates readout ──────────────────────────────────────
  Widget _buildReadout() {
    final (statusColor, statusIcon, statusLabel) = _statusVisuals();

    final coords = _currentLocation == null
        ? '—'
        : '${_currentLocation!.latitude.toStringAsFixed(5)}, '
            '${_currentLocation!.longitude.toStringAsFixed(5)}';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.glassFill,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.glassBorderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.glassFillStrong,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(PhosphorIconsFill.navigationArrow,
                    size: 19, color: AppColors.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text('Your current location',
                    style: _t(
                        size: 14,
                        weight: FontWeight.w700,
                        color: AppColors.onGlassPrimary)),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(statusIcon, size: 13, color: statusColor),
                    const SizedBox(width: 4),
                    Text(statusLabel,
                        style: _t(
                            size: 10.5,
                            weight: FontWeight.w700,
                            color: statusColor)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _readoutRow(
            icon: PhosphorIconsFill.gpsFix,
            label: 'Coordinates',
            value: coords,
            mono: true,
          ),
          const SizedBox(height: 12),
          if (_status == _LiveLocationStatus.unavailable)
            GestureDetector(
              onTap: _locate,
              child: Row(
                children: [
                  const Icon(PhosphorIconsFill.arrowsClockwise,
                      size: 15, color: AppColors.primaryDark),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Live location is unavailable. Check location '
                      'permissions and tap to try again.',
                      style: _t(
                          size: 11.5,
                          weight: FontWeight.w500,
                          color: AppColors.primaryDark),
                    ),
                  ),
                ],
              ),
            )
          else if (_status == _LiveLocationStatus.outside)
            Text(
              'Your live position is currently outside Monticello Villas.',
              style: _t(size: 11.5, color: AppColors.onGlassMuted, height: 1.4),
            )
          else
            Text(
              'This map shows your live position within Monticello Villas. '
              'To report an incident at a specific spot, use Report.',
              style: _t(size: 11.5, color: AppColors.onGlassMuted, height: 1.4),
            ),
        ],
      ),
    );
  }

  Widget _readoutRow({
    required IconData icon,
    required String label,
    required String value,
    bool mono = false,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 15, color: AppColors.onGlassMuted),
        const SizedBox(width: 10),
        SizedBox(
          width: 86,
          child: Text(label,
              style: _t(size: 12.5, color: AppColors.onGlassSecondary)),
        ),
        Expanded(
          child: Text(
            value,
            style: mono
                // `monospace` fallback for the same reason sfPro carries one:
                // an unfetched Roboto Mono must degrade to the platform's own
                // monospace face, not to a font with no metrics.
                ? GoogleFonts.robotoMono(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.onGlassPrimary,
                  ).copyWith(fontFamilyFallback: const ['monospace'])
                : _t(
                    size: 12.5,
                    weight: FontWeight.w600,
                    color: AppColors.onGlassPrimary),
          ),
        ),
      ],
    );
  }
}

/// View-only "you are here" avatar pin — the resident's profile photo, or their
/// initials on a branded gradient when no photo is set, shaped like the
/// reference: a white-ringed circle above a small pointed tail whose tip marks
/// the location. Static by design: it carries no tap handler, so it can't open
/// the edit-profile menu.
class _AvatarMarker extends StatelessWidget {
  const _AvatarMarker({required this.photoUrl, required this.initials});

  final String photoUrl;
  final String initials;

  @override
  Widget build(BuildContext context) {
    final hasPhoto = photoUrl.isNotEmpty;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: hasPhoto ? Colors.white : null,
            gradient: hasPhoto
                ? null
                : const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppColors.primary, AppColors.primaryLight],
                  ),
            border: Border.all(color: Colors.white, width: 3),
            image: hasPhoto
                ? DecorationImage(
                    image: NetworkImage(photoUrl), fit: BoxFit.cover)
                : null,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.28),
                blurRadius: 8,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: hasPhoto
              ? null
              : Center(
                  child: Text(
                    initials,
                    style: _t(
                        size: 16, weight: FontWeight.w700, color: Colors.white),
                  ),
                ),
        ),
        // Pointed tail (white, matching the ring) — its tip marks the spot.
        Transform.translate(
          offset: const Offset(0, -3),
          child: CustomPaint(
            size: const Size(16, 12),
            painter: _PinTailPainter(),
          ),
        ),
      ],
    );
  }
}

/// Draws the small downward-pointing white tail beneath the avatar circle.
class _PinTailPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = ui.Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();

    // Soft shadow under the tip.
    canvas.drawShadow(path, Colors.black.withValues(alpha: 0.35), 3, false);
    canvas.drawPath(path, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
