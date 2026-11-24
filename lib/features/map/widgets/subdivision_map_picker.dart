import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';

typedef PinChanged = void Function(LatLng position);

class SubdivisionMapPicker extends StatefulWidget {
  const SubdivisionMapPicker({
    super.key,
    required this.selected,
    required this.onChanged,
    this.height = 260,
    this.showHint = true,
    this.radarColor = AppColors.primary,
    this.radarLabel = 'Medium',
  });

  final LatLng selected;
  final PinChanged onChanged;
  final double height;
  final bool showHint;
  final Color radarColor;
  final String radarLabel;

  @override
  State<SubdivisionMapPicker> createState() => _SubdivisionMapPickerState();
}

class _SubdivisionMapPickerState extends State<SubdivisionMapPicker> {
  final MapController _controller = MapController();
  bool _showWarning = false;
  bool _satellite = false;

  void _handleTap(TapPosition tapPosition, LatLng latlng) {
    if (!MapConstants.containsInSubdivision(latlng)) {
      setState(() => _showWarning = true);
      Future.delayed(const Duration(seconds: 3), () {
        if (mounted) setState(() => _showWarning = false);
      });
      return;
    }
    HapticFeedback.selectionClick();
    widget.onChanged(latlng);
    setState(() => _showWarning = false);
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: SizedBox(
        height: widget.height,
        width: double.infinity,
        // Claims vertical/horizontal drag gestures for this region before
        // any ancestor scrollable can treat them as a page scroll — the map
        // sits in a form that scrolls elsewhere on the same screen, so
        // without this a pan gesture that starts on the map can otherwise
        // be interpreted as scrolling the surrounding page instead of
        // panning the map itself.
        child: GestureDetector(
          onVerticalDragStart: (_) {},
          onVerticalDragUpdate: (_) {},
          onHorizontalDragStart: (_) {},
          onHorizontalDragUpdate: (_) {},
          child: Stack(
          children: [
            FlutterMap(
              mapController: _controller,
              options: MapOptions(
                initialCenter: widget.selected,
                initialZoom: MapConstants.defaultZoom,
                // NO minZoom/maxZoom — pinch-to-zoom is unconstrained in both
                // directions, matching the native picker this stands in for.
                // Over-zoom past the deepest tile is handled by the TileLayer's
                // maxNativeZoom below, so the map softens rather than blanks.
                keepAlive: true,
                // Explicit rather than relying on the library default, so
                // drag/pinch/double-tap-zoom/fling are guaranteed enabled
                // regardless of future default changes upstream.
                interactionOptions: const InteractionOptions(
                  flags: InteractiveFlag.drag |
                      InteractiveFlag.pinchZoom |
                      InteractiveFlag.doubleTapZoom |
                      InteractiveFlag.flingAnimation,
                ),
                onPositionChanged: (position, _) {
                  final center = position.center;
                  if (center == null) return;
                  if (MapConstants.containsInSubdivision(center)) return;
                  final clamped = MapConstants.clampToSubdivision(center);
                  _controller.move(
                    clamped,
                    position.zoom ?? MapConstants.defaultZoom,
                  );
                },
                onTap: _handleTap,
              ),
              children: [
                TileLayer(
                  urlTemplate: _satellite
                      ? MapConstants.satelliteTileUrl
                      : MapConstants.tileUrl,
                  userAgentPackageName: 'com.monticello_villas_app',
                  // maxNativeZoom, NOT maxZoom — `maxZoom` stops the layer
                  // drawing past 19 and leaves a blank grid on over-zoom.
                  maxNativeZoom: 19,
                ),
                // LINE ONLY, one colour on both basemaps. The fill went for the
                // same reason it went everywhere else: it tinted the imagery
                // being read. The per-basemap white/blue swap went with it —
                // the boundary is the same boundary whichever tiles are under
                // it, and emerald holds up on both.
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
                MarkerLayer(
                  markers: [
                    Marker(
                      width: 40,
                      height: 40,
                      point: widget.selected,
                      alignment: Alignment.center,
                      child: _ModernPin(
                        color: widget.radarColor,
                        satellite: _satellite,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            // Top row: hint + satellite toggle
            if (widget.showHint)
              Positioned(
                left: AppSpacing.sm,
                right: AppSpacing.sm,
                top: AppSpacing.sm,
                child: Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                        child: BackdropFilter(
                          filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                          child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.backgroundSecondary
                              .withValues(alpha: 0.75),
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                          border:
                              Border.all(color: AppColors.glassBorderLight),
                        ),
                        child: Row(
                          children: [
                            Icon(PhosphorIconsFill.handTap,
                                color: widget.radarColor, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Tap inside Monticello Villas to pin exact spot',
                                style: sfPro(
                                  fontSize: 12,
                                  color: AppColors.textSecondary,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: widget.radarColor
                                    .withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(
                                  color: widget.radarColor
                                      .withValues(alpha: 0.30),
                                ),
                              ),
                              child: Text(
                                widget.radarLabel,
                                style: sfPro(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                  color: widget.radarColor,
                                  letterSpacing: 0.2,
                                ),
                              ),
                            ),
                          ],
                        ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // Satellite / Street toggle
            Positioned(
              right: 10,
              bottom: _showWarning ? 58 : 10,
              child: GestureDetector(
                onTap: () {
                  HapticFeedback.selectionClick();
                  setState(() => _satellite = !_satellite);
                },
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppColors.backgroundSecondary
                            .withValues(alpha: 0.75),
                        borderRadius: BorderRadius.circular(10),
                        border:
                            Border.all(color: AppColors.glassBorderLight),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _satellite
                                ? PhosphorIconsFill.mapTrifold
                                : PhosphorIconsFill.planet,
                            size: 15,
                            color: AppColors.textPrimary,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _satellite ? 'Street' : 'Satellite',
                            style: sfPro(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textPrimary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),

            // Out-of-bounds warning
            if (_showWarning)
              Positioned(
                left: 8,
                right: 8,
                bottom: 8,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.backgroundSecondary
                            .withValues(alpha: 0.85),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: AppColors.primary.withValues(alpha: 0.30)),
                      ),
                      child: Row(
                        children: [
                          const Icon(PhosphorIconsFill.gpsSlash,
                              color: AppColors.primary, size: 18),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Outside boundary — pins restricted to Monticello Villas',
                              style: sfPro(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                color: AppColors.primary,
                              ),
                            ),
                          ),
                        ],
                      ),
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
}

class _ModernPin extends StatelessWidget {
  final Color color;
  final bool satellite;

  const _ModernPin({required this.color, required this.satellite});

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color.withValues(alpha: 0.12),
            border: Border.all(color: color.withValues(alpha: 0.30), width: 1.5),
          ),
        ),
        Container(
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color,
            border: Border.all(
              color: satellite ? Colors.black54 : Colors.white,
              width: 2.5,
            ),
            // Neutral — see map_screen. Was the pin colour at 45%, washing
            // the imagery immediately under the pin.
            boxShadow: AppShadows.sm,
          ),
        ),
      ],
    );
  }
}
