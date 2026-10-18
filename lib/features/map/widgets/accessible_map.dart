import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/map_controls.dart';

// ═══════════════════════════════════════════════════════════════════════════
// AccessibleMap
//
// A reusable Mapbox (raster-tile) map for `flutter_map` with first-class
// accessibility baked in. Responsibilities are split into clear blocks:
//   1. Configuration   — basemap styles (see [AccessibleMapStyle]) + token,
//                         all sourced from [MapConstants].
//   2. Initialization  — FlutterMap + TileLayer wiring in [build].
//   3. Accessibility   — keyboard navigation ([_onKey]), screen-reader
//                         semantics, visible nav controls, a high-contrast
//                         style toggle, and required attribution.
//
// NOTE ON PITCH: `flutter_map` is a 2D raster engine, so true 3D pitch/tilt is
// not available. We expose the controls it *can* honour — zoom, compass
// (rotation) and recenter. For real pitch you would migrate to the native
// `mapbox_maps_flutter` SDK.
// ═══════════════════════════════════════════════════════════════════════════

/// Selectable basemaps. `highContrast` swaps to Mapbox's dark style for
/// low-vision users and bright-sunlight readability.
enum AccessibleMapStyle { street, satellite, highContrast }

extension AccessibleMapStyleX on AccessibleMapStyle {
  /// Mapbox (or fallback) raster tile URL for this style.
  String get tileUrl {
    switch (this) {
      case AccessibleMapStyle.street:
        return MapConstants.tileUrl;
      case AccessibleMapStyle.satellite:
        return MapConstants.satelliteTileUrl;
      case AccessibleMapStyle.highContrast:
        return MapConstants.darkTileUrl;
    }
  }

  String get label {
    switch (this) {
      case AccessibleMapStyle.street:
        return 'Street';
      case AccessibleMapStyle.satellite:
        return 'Satellite';
      case AccessibleMapStyle.highContrast:
        return 'High contrast';
    }
  }

  IconData get icon {
    switch (this) {
      case AccessibleMapStyle.street:
        return PhosphorIconsFill.mapTrifold;
      case AccessibleMapStyle.satellite:
        return PhosphorIconsFill.planet;
      case AccessibleMapStyle.highContrast:
        return PhosphorIconsFill.circleHalf;
    }
  }
}

class AccessibleMap extends StatefulWidget {
  const AccessibleMap({
    super.key,
    this.controller,
    required this.initialCenter,
    required this.initialZoom,
    this.layers = const [],
    this.onTap,
    this.clampToBounds = false,
    this.recenterTarget,
    this.recenterZoom,
    this.initialStyle = AccessibleMapStyle.street,
    this.showControls = true,
    this.semanticLabel =
        'Interactive map. Press Tab to focus the map, then use the arrow keys '
        'to pan, plus and minus to zoom, Q and E to rotate, and 0 to reset '
        'north.',
  });

  /// Optionally share a [MapController] with the parent (for external
  /// recenter/zoom). If null, one is created and owned internally.
  final MapController? controller;
  final LatLng initialCenter;
  final double initialZoom;
  // minZoom/maxZoom are GONE from this API rather than merely ignored. Zooming
  // is unconstrained now, and a parameter that a caller can still pass while it
  // quietly changes nothing is worse than no parameter at all.

  /// Extra map layers (polygons, markers, …) stacked above the basemap.
  final List<Widget> layers;
  final void Function(TapPosition tapPosition, LatLng point)? onTap;

  /// Keep the camera inside the Monticello Villas boundary.
  final bool clampToBounds;
  final LatLng? recenterTarget;
  final double? recenterZoom;
  final AccessibleMapStyle initialStyle;
  final bool showControls;

  /// Screen-reader description announced for the whole map region.
  final String semanticLabel;

  @override
  State<AccessibleMap> createState() => _AccessibleMapState();
}

class _AccessibleMapState extends State<AccessibleMap> {
  late final MapController _map = widget.controller ?? MapController();
  final FocusNode _focusNode = FocusNode(debugLabel: 'AccessibleMap');
  StreamSubscription<MapEvent>? _eventSub;

  late AccessibleMapStyle _style = widget.initialStyle;
  double _rotation = 0; // degrees, for the compass control

  // Keyboard step sizes.
  static const double _panFraction = 0.25; // % of the visible viewport
  static const double _zoomStep = 0.5;
  static const double _rotateStep = 15;

  @override
  void initState() {
    super.initState();
    // Repaint the focus ring + compass when focus or camera changes.
    _focusNode.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _focusNode.removeListener(_onFocusChanged);
    _focusNode.dispose();
    if (widget.controller == null) _map.dispose();
    super.dispose();
  }

  void _onFocusChanged() => setState(() {});

  // ── Camera helpers (initialization-adjacent) ──────────────────────────────

  void _moveClamped(LatLng center, double zoom) {
    final target =
        widget.clampToBounds ? MapConstants.clampToSubdivision(center) : center;
    _map.move(target, zoom);
  }

  /// Keyboard-only now — the on-screen zoom pair is gone. This is the sole
  /// non-gesture path to zoom, which is why the shortcut survived the cut.
  void _zoomBy(double delta) {
    // No clamp. `MapOptions` no longer sets min/max zoom, so there is nothing
    // to clamp TO; flutter_map's own guard rails are the only limit left.
    _map.move(_map.camera.center, _map.camera.zoom + delta);
  }

  /// Pan by a fraction of the currently visible span (so the step feels the
  /// same at every zoom level). dx: +east/-west, dy: +north/-south.
  void _panByFraction(double dx, double dy) {
    final cam = _map.camera;
    final b = cam.visibleBounds;
    final latSpan = b.north - b.south;
    final lngSpan = b.east - b.west;
    _moveClamped(
      LatLng(
        cam.center.latitude + dy * latSpan * _panFraction,
        cam.center.longitude + dx * lngSpan * _panFraction,
      ),
      cam.zoom,
    );
  }

  void _rotateBy(double degrees) => _map.rotate(_map.camera.rotation + degrees);
  void _resetNorth() => _map.rotate(0);

  /// Recentre, and straighten.
  ///
  /// The bearing reset used to belong to the compass button. With the compass
  /// gone from the control cluster, a resident who twisted the map with two
  /// fingers had no way back to north short of twisting it back by eye — so
  /// recentre absorbed the job. "Put the map back" is one intent, not two.
  void _recenter() {
    _resetNorth();
    _moveClamped(
      widget.recenterTarget ?? widget.initialCenter,
      widget.recenterZoom ?? widget.initialZoom,
    );
  }

  /// Streets ↔ Satellite. A strict two-state toggle, not a cycle.
  ///
  /// This used to advance through all three [AccessibleMapStyle] values, which
  /// meant tapping the one visible layer button could land the resident on the
  /// dark high-contrast basemap with no label saying what had happened and two
  /// more taps to get home. Two states, and the icon names the destination.
  void _toggleStyle() {
    setState(() {
      _style = _style == AccessibleMapStyle.satellite
          ? AccessibleMapStyle.street
          : AccessibleMapStyle.satellite;
    });
  }

  /// High contrast is no longer reachable by tapping — there are two buttons on
  /// this map and neither is a third basemap. It is a low-vision affordance,
  /// though, so deleting it outright would be a straight accessibility
  /// regression; it keeps a keyboard shortcut instead, and callers can still
  /// open the map on it via `initialStyle`.
  void _toggleHighContrast() {
    setState(() {
      _style = _style == AccessibleMapStyle.highContrast
          ? AccessibleMapStyle.street
          : AccessibleMapStyle.highContrast;
    });
  }

  // ── Accessibility: keyboard navigation ────────────────────────────────────
  // Standard map shortcuts mirrored from Mapbox GL JS so muscle memory carries
  // over: arrows pan, +/- zoom, Q/E rotate, 0 resets bearing to north. H is
  // ours, for the high-contrast basemap.
  //
  // THIS HANDLER CARRIES MORE WEIGHT THAN IT USED TO. The on-screen control
  // cluster is down to two buttons, so zoom, rotate and high contrast have no
  // pointer affordance left — these bindings are the whole non-gesture path to
  // them. Removing one now removes the action.
  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final k = event.logicalKey;
    if (k == LogicalKeyboardKey.arrowUp) {
      _panByFraction(0, 1);
    } else if (k == LogicalKeyboardKey.arrowDown) {
      _panByFraction(0, -1);
    } else if (k == LogicalKeyboardKey.arrowLeft) {
      _panByFraction(-1, 0);
    } else if (k == LogicalKeyboardKey.arrowRight) {
      _panByFraction(1, 0);
    } else if (k == LogicalKeyboardKey.equal ||
        k == LogicalKeyboardKey.add ||
        k == LogicalKeyboardKey.numpadAdd) {
      _zoomBy(_zoomStep);
    } else if (k == LogicalKeyboardKey.minus ||
        k == LogicalKeyboardKey.numpadSubtract) {
      _zoomBy(-_zoomStep);
    } else if (k == LogicalKeyboardKey.keyQ) {
      _rotateBy(-_rotateStep);
    } else if (k == LogicalKeyboardKey.keyE) {
      _rotateBy(_rotateStep);
    } else if (k == LogicalKeyboardKey.digit0) {
      _resetNorth();
    } else if (k == LogicalKeyboardKey.keyH) {
      _toggleHighContrast();
    } else {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    // The map region is exposed to screen readers as a single labelled node
    // describing how to operate it via keyboard.
    return Semantics(
      container: true,
      label: widget.semanticLabel,
      child: Focus(
        focusNode: _focusNode,
        onKeyEvent: _onKey,
        child: Stack(
          children: [
            FlutterMap(
              mapController: _map,
              options: MapOptions(
                initialCenter: widget.initialCenter,
                initialZoom: widget.initialZoom,
                // NO minZoom/maxZoom. A pinch that stops dead with fingers
                // still moving reads as a frozen map, not as a limit; past the
                // last tile level the raster is upscaled instead (see the
                // TileLayer's maxNativeZoom), so it goes soft rather than
                // blank.
                // Tapping the map also gives it keyboard focus.
                onTap: (tapPosition, point) {
                  _focusNode.requestFocus();
                  widget.onTap?.call(tapPosition, point);
                },
                // Full gesture set incl. rotation. Recentre resets bearing,
                // which is the way back from a twisted map now the compass
                // button is gone.
                interactionOptions:
                    const InteractionOptions(flags: InteractiveFlag.all),
                onMapReady: () {
                  // Keep the compass icon in sync with the live camera bearing.
                  _eventSub = _map.mapEventStream.listen((_) {
                    final r = _map.camera.rotation;
                    if (mounted && r != _rotation) {
                      setState(() => _rotation = r);
                    }
                  });
                },
                onPositionChanged: (position, hasGesture) {
                  if (!widget.clampToBounds) return;
                  final c = position.center;
                  if (c != null && !MapConstants.containsInSubdivision(c)) {
                    _map.move(MapConstants.clampToSubdivision(c),
                        position.zoom ?? widget.initialZoom);
                  }
                },
              ),
              children: [
                TileLayer(
                  urlTemplate: _style.tileUrl,
                  userAgentPackageName: 'com.example.monticello_villas_app',
                  // maxNativeZoom, NOT maxZoom. `maxZoom` stops the layer
                  // rendering past 19 and the map goes blank on over-zoom;
                  // maxNativeZoom says "19 is the deepest tile that exists,
                  // scale it from there", which is what lets the camera keep
                  // zooming now that MapOptions imposes no ceiling.
                  maxNativeZoom: 19,
                ),
                ...widget.layers,
              ],
            ),

            // Visible focus ring — a clear, high-contrast indicator that the
            // map currently has keyboard focus.
            if (_focusNode.hasFocus)
              Positioned.fill(
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border.all(color: AppColors.primary, width: 3),
                    ),
                  ),
                ),
              ),

            if (widget.showControls) _buildControls(),
            _buildAttribution(),
          ],
        ),
      ),
    );
  }

  // ── Visible navigation controls ───────────────────────────────────────────
  //
  // Two buttons, from the shared [MapControlCluster] — the same pair, the same
  // glyphs and the same 44px discs the homepage card and the incident picker
  // render. This screen used to draw its own five-button column in its own
  // private button class, which is how the three maps ended up with three
  // different pictures of "recentre".
  //
  // What left: zoom in, zoom out, and the compass. See MapControlCluster for
  // the reasoning and the accessibility cost; the keyboard bindings in [_onKey]
  // are what keeps those actions reachable, and [_recenter] absorbed the
  // compass's reset-north job.
  Widget _buildControls() {
    return Positioned(
      right: 14,
      bottom: 64,
      child: MapControlCluster(
        children: [
          MapControlButton(
            icon: _style == AccessibleMapStyle.satellite
                ? MapActionIcons.toStreets
                : MapActionIcons.toSatellite,
            tooltip: _style == AccessibleMapStyle.satellite
                ? 'Switch to Streets'
                : 'Switch to Satellite',
            onTap: _toggleStyle,
          ),
          MapControlButton(
            icon: MapActionIcons.currentLocation,
            tooltip: 'Recenter map',
            onTap: _recenter,
          ),
        ],
      ),
    );
  }

  // ── Required Mapbox / OSM attribution ─────────────────────────────────────
  Widget _buildAttribution() {
    return Positioned(
      left: 10,
      bottom: 10,
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: AppColors.backgroundSecondary.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(6),
          ),
          child: const Text(
            MapConstants.mapboxAttribution,
            style: TextStyle(
              fontSize: 10,
              color: AppColors.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

// The private `_MapControlButton` that used to live here is gone. It was a
// near-copy of the shared MapControlButton with its own elevation, its own
// shadow colour and its own accent rule, which is exactly how three maps ended
// up looking like three products. Use `MapControlButton` from
// `core/widgets/map_controls.dart`.
