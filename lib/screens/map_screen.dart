import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:latlong2/latlong.dart';

import '../config/map_constants.dart';
import '../theme/app_theme.dart';
import '../widgets/glass_container.dart';
import '../widgets/gradient_scaffold.dart';
import '../widgets/shared_widgets.dart';

/// Full-screen subdivision map (same OSM tile stack as the report-flow picker).
/// Optional entry point from routes; primary pinning happens on [ReportIncidentScreen].
class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final MapController _controller = MapController();

  void _zoom(double delta) {
    final cam = _controller.camera;
    final z =
        (cam.zoom + delta).clamp(MapConstants.minZoom, MapConstants.maxZoom);
    _controller.move(cam.center, z);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      appBar: AppBar(
        title: const Text('Subdivision map'),
        actions: [
          IconButton(
            onPressed: () =>
                _controller.move(MapConstants.subdivisionCenter, MapConstants.defaultZoom),
            icon: const Icon(Icons.center_focus_strong_outlined),
            tooltip: 'Recenter',
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xl),
        child: Column(
          children: [
            GlassContainer(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md, vertical: 6),
              borderRadius: AppRadius.pill,
              child: Row(
                children: [
                  const Icon(Icons.info_outline,
                      color: AppColors.textMuted, size: 18),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      'Driving-road map view for Monticello Villas only. Incident radar appears in Report incident.',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Expanded(
              child: GlassContainer(
                padding: EdgeInsets.zero,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: Stack(
                    children: [
                      FlutterMap(
                        mapController: _controller,
                        options: MapOptions(
                          initialCenter: MapConstants.subdivisionCenter,
                          initialZoom: MapConstants.defaultZoom,
                          minZoom: MapConstants.minZoom,
                          maxZoom: MapConstants.maxZoom,
                          onPositionChanged: (position, _) {
                            final center = position.center;
                            if (center == null) return;
                            if (MapConstants.containsInSubdivision(center)) {
                              return;
                            }
                            final clamped =
                                MapConstants.clampToSubdivision(center);
                            _controller.move(
                              clamped,
                              position.zoom ?? MapConstants.defaultZoom,
                            );
                          },
                        ),
                        children: [
                          TileLayer(
                            urlTemplate:
                                'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                            userAgentPackageName:
                                'com.example.monticello_villas_app',
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
                                borderColor:
                                    AppColors.accent.withValues(alpha: 0.45),
                                borderStrokeWidth: 2,
                              ),
                            ],
                          ),
                          MarkerLayer(
                            markers: [
                              Marker(
                                width: 40,
                                height: 40,
                                point: const LatLng(14.4205, 120.9253),
                                alignment: Alignment.bottomCenter,
                                child: _pinDot(AppColors.danger),
                              ),
                              Marker(
                                width: 40,
                                height: 40,
                                point: const LatLng(14.4190, 120.9275),
                                alignment: Alignment.bottomCenter,
                                child: _pinDot(AppColors.warning),
                              ),
                              Marker(
                                width: 48,
                                height: 48,
                                point: MapConstants.subdivisionCenter,
                                alignment: Alignment.bottomCenter,
                                child: Icon(
                                  Icons.location_pin,
                                  size: 40,
                                  color: AppColors.accent,
                                  shadows: const [
                                    Shadow(blurRadius: 8, color: Colors.black54),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                      Positioned(
                        left: AppSpacing.md,
                        bottom: AppSpacing.md,
                        right: AppSpacing.md,
                        child: _Legend(),
                      ),
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
                              onTap: () => _zoom(1),
                              child: const Icon(Icons.add,
                                  color: AppColors.textPrimary, size: 20),
                            ),
                            const SizedBox(height: 8),
                            GlassContainer(
                              width: 42,
                              height: 42,
                              padding: EdgeInsets.zero,
                              borderRadius: 14,
                              onTap: () => _zoom(-1),
                              child: const Icon(Icons.remove,
                                  color: AppColors.textPrimary, size: 20),
                            ),
                            const SizedBox(height: 8),
                            GlassContainer(
                              width: 42,
                              height: 42,
                              padding: EdgeInsets.zero,
                              borderRadius: 14,
                              onTap: () {
                                _controller.move(
                                  MapConstants.subdivisionCenter,
                                  MapConstants.defaultZoom,
                                );
                              },
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
            ),
            const SizedBox(height: AppSpacing.md),
            PrimaryButton(
              label: 'Done',
              icon: Icons.check_outlined,
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pinDot(Color color) {
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: [
          BoxShadow(color: color.withValues(alpha: 0.5), blurRadius: 10),
        ],
      ),
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
