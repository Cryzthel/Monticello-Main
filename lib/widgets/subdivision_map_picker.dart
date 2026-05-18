import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:latlong2/latlong.dart';

import '../config/map_constants.dart';
import '../theme/app_theme.dart';

typedef PinChanged = void Function(LatLng position);

/// OSM-based map picker (same tile stack as Leaflet). Tap to place the pin.
class SubdivisionMapPicker extends StatefulWidget {
  const SubdivisionMapPicker({
    super.key,
    required this.selected,
    required this.onChanged,
    this.height = 260,
    this.showHint = true,
    this.radarColor = AppColors.warning,
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

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: SizedBox(
        height: widget.height,
        width: double.infinity,
        child: Stack(
          children: [
            FlutterMap(
              mapController: _controller,
              options: MapOptions(
                initialCenter: widget.selected,
                initialZoom: MapConstants.defaultZoom,
                minZoom: MapConstants.minZoom,
                maxZoom: MapConstants.maxZoom,
                keepAlive: true,
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
                onTap: (tapPosition, latlng) {
                  HapticFeedback.selectionClick();
                  widget.onChanged(MapConstants.clampToSubdivision(latlng));
                  setState(() {});
                },
              ),
              children: [
                TileLayer(
                  urlTemplate:
                      'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                  userAgentPackageName: 'com.example.monticello_villas_app',
                ),
                PolygonLayer(
                  polygons: [
                    Polygon(
                      points: [
                        LatLng(
                          MapConstants.subdivisionNorthEast.latitude,
                          MapConstants.subdivisionSouthWest.longitude,
                        ),
                        MapConstants.subdivisionNorthEast,
                        LatLng(
                          MapConstants.subdivisionSouthWest.latitude,
                          MapConstants.subdivisionNorthEast.longitude,
                        ),
                        MapConstants.subdivisionSouthWest,
                      ],
                      color: AppColors.accent.withValues(alpha: 0.08),
                      borderColor: AppColors.accent.withValues(alpha: 0.45),
                      borderStrokeWidth: 2,
                    ),
                  ],
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      width: 86,
                      height: 86,
                      point: widget.selected,
                      alignment: Alignment.center,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          Container(
                            width: 74,
                            height: 74,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: widget.radarColor.withValues(alpha: 0.12),
                              border: Border.all(
                                color: widget.radarColor.withValues(alpha: 0.45),
                                width: 1.4,
                              ),
                            ),
                          ),
                          Container(
                            width: 54,
                            height: 54,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: widget.radarColor.withValues(alpha: 0.16),
                              border: Border.all(
                                color: widget.radarColor.withValues(alpha: 0.55),
                                width: 1.2,
                              ),
                            ),
                          ),
                          Icon(
                            Icons.location_pin,
                            size: 42,
                            color: widget.radarColor,
                            shadows: const [
                              Shadow(blurRadius: 8, color: Colors.black54),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
            if (widget.showHint)
              Positioned(
                left: AppSpacing.sm,
                right: AppSpacing.sm,
                top: AppSpacing.sm,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.45),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: 8,
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.touch_app_outlined,
                            color: Colors.white, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Tap inside Monticello Villas to pin exact incident spot',
                            style: GoogleFonts.inter(
                              fontSize: 12,
                              color: Colors.white,
                              fontWeight: FontWeight.w500,
                              shadows: const [
                                Shadow(
                                  color: Color(0xB3000000),
                                  blurRadius: 12,
                                  offset: Offset(0, 1),
                                ),
                                Shadow(
                                  color: Color(0x66000000),
                                  blurRadius: 20,
                                ),
                              ],
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
                            color: widget.radarColor.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: widget.radarColor.withValues(alpha: 0.55),
                            ),
                          ),
                          child: Text(
                            widget.radarLabel,
                            style: GoogleFonts.inter(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                              letterSpacing: 0.2,
                              shadows: const [
                                Shadow(
                                  color: Color(0x99000000),
                                  blurRadius: 8,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
