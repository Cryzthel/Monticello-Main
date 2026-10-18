import 'dart:async';
// PREFIXED. `mapbox_maps_flutter` exports its own `Size`, and Dart resolves a
// name from a package library over one from a `dart:` library — so an
// unprefixed `Size` in this file silently means Mapbox's pigeon type, not the
// geometry one CustomPainter expects.
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart' show Factory, kIsWeb;
import 'package:flutter/gestures.dart'
    show EagerGestureRecognizer, OneSequenceGestureRecognizer;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
// Prefixed: geolocator's `LocationAccuracy` would shadow Mapbox's puck types.
import 'package:geolocator/geolocator.dart' as geo;
import 'package:latlong2/latlong.dart' as ll;
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/map_controls.dart';
import 'package:monticello_villas_app/features/map/widgets/subdivision_map_picker.dart';
import 'package:monticello_villas_app/features/property/services/lot_reference_store.dart';

typedef PinChanged = void Function(ll.LatLng position);

/// Native Mapbox incident location picker.
///
/// Renders through `mapbox_maps_flutter`, so the mobile app shows the SAME
/// vector styles the web dashboards' Mapbox GL JS maps do rather than
/// pre-rendered raster tiles of them, and the subdivision boundary is a real
/// map layer instead of a widget drawn on top.
///
/// [selected]/[onChanged] speak `latlong2.LatLng` because [MapConstants] does
/// the geofence maths in that type; conversion to Mapbox's `Point`/`Position`
/// geometry happens only at this boundary.
///
/// GRAB-STYLE PINNING. The pin is a widget fixed at the viewport centre and the
/// map slides underneath it. There is deliberately no tap-to-place: two ways to
/// move the pin meant a stray touch while steadying the phone could silently
/// relocate the incident.
///
/// The drag is LIVE from the first frame. There is no mode to enter, no chip to
/// tap and no scrim to dismiss first — the map answers the resident's first
/// touch. What that costs, and why it is worth paying, is written up at the
/// "NO INTERACTION GATE" note in the state class.
class IncidentMapPicker extends StatefulWidget {
  const IncidentMapPicker({
    super.key,
    required this.selected,
    required this.onChanged,
    this.height = 260,
    this.showHint = true,
    this.radarColor = AppColors.primary,
  });

  final ll.LatLng selected;
  final PinChanged onChanged;
  final double height;
  final bool showHint;

  /// The selected incident category's hue — the pin takes it, so "what
  /// happened" and "where" read as one fact.
  final Color radarColor;

  // onPhaseDetected was here. It reported which phase the pin was nearest, and
  // the panel used it to warn about a disagreement with the typed address. Both
  // are gone: the phase was inferred from a four-point anchor table, so the
  // "disagreement" it flagged was as likely to be the table's fault as the
  // resident's — a warning that cannot tell you which side is wrong is noise.

  @override
  State<IncidentMapPicker> createState() => _IncidentMapPickerState();
}

class _IncidentMapPickerState extends State<IncidentMapPicker> {
  /// `right-4` / `top-4`: the control stack's distance from the map edge.
  static const double _controlInset = 16;

  MapboxMap? _map;

  /// The subdivision perimeter — one stroke, no fill. See [_drawBoundary].
  PolylineAnnotationManager? _boundaryCore;

  /// The Grab-style nearby-lot tags: a dot at each known lot and its label
  /// above it. Two managers because Mapbox draws circles and symbols through
  /// different layers.
  ///
  /// These live in the MAP's coordinate space, not the widget's, which is the
  /// whole reason they can update on idle rather than every frame — a tag sits
  /// on a fixed real-world point, so while the map is being dragged it slides
  /// along with the imagery for free. Only the SET of nearby lots changes, and
  /// that can wait for the camera to settle.
  CircleAnnotationManager? _lotDots;
  PointAnnotationManager? _lotLabels;

  /// Guards against two refreshes overlapping — each one deletes and recreates
  /// every annotation, and interleaving them leaves orphans on the map.
  bool _refreshingLots = false;

  /// Satellite first, matching the dashboard map. Pinning is the one task where
  /// imagery beats a street basemap: the resident identifies a spot by what
  /// they can see, not by a road name they already know.
  bool _satellite = true;

  bool _showWarning = false;
  Timer? _warningTimer;

  /// Shown when the location button is tapped but no fix can be had.
  bool _showNoLocation = false;
  Timer? _noFixTimer;

  /// True while the map is moving under the centre-anchored pin.
  ///
  /// A ValueNotifier, NOT a setState flag. This is the fix for "zoom does not
  /// work": camera-change events fire every frame, and calling setState on each
  /// one rebuilt this whole widget including [MapWidget]. Because
  /// [CameraViewportState] has no value equality, a rebuilt widget always looks
  /// like it carries a NEW viewport, so MapWidget re-applied it and snapped the
  /// camera back to the opening centre and zoom — mid-pinch, on every frame,
  /// which is indistinguishable from zooming being disabled.
  ///
  /// Only the pin listens, so the map subtree is never rebuilt by its own
  /// camera movement.
  final ValueNotifier<bool> _dragging = ValueNotifier<bool>(false);

  /// Where the camera is RIGHT NOW, updated on every camera frame.
  ///
  /// A ValueNotifier for exactly the reason [_dragging] is one: this changes
  /// sixty times a second while a finger is down, and routing it through
  /// setState would rebuild [MapWidget] and snap the camera back mid-gesture.
  /// Only the pin badge and the status pill listen.
  ///
  /// Null until the camera first moves, which is what lets the status bar show
  /// the drag hint to someone who has not worked out the gesture yet, and the
  /// live phase read-out to everyone who has.
  final ValueNotifier<ll.LatLng?> _liveCentre = ValueNotifier<ll.LatLng?>(null);

  // ── NO INTERACTION GATE ───────────────────────────────────────────────────
  //
  // `_interactive` was here: the map opened inert behind a transparent overlay
  // and a "Tap to move the pin" chip handed it its gestures. That bought the
  // page one thing — a vertical drag starting on the map scrolled the form
  // instead of panning — and charged every resident an extra tap, plus a
  // reading of the chip, before the primary action of the screen would respond
  // at all. A map that ignores the first drag reads as broken far more often
  // than a map that pans when the page was meant to scroll.
  //
  // The map is now live from the frame it appears. The trade-off is real and
  // unchanged in nature — the EagerGestureRecognizer below claims a pointer the
  // instant it lands, so a drag STARTING inside the map card does not reach the
  // step's SingleChildScrollView. It is bounded, though: the card is a few
  // hundred pixels of a much taller column, and the address card above it, the
  // coordinate read-out and description below it, and the gutters either side
  // all scroll normally.

  /// Last centre reported while dragging, committed on idle.
  ll.LatLng? _pendingCentre;

  /// Whether the live puck came up. Does not gate the recentre button — it only
  /// avoids re-running permission setup on every tap.
  bool _hasLiveLocation = false;

  /// Standard GPS blue, deliberately not the category colour: "where I am" and
  /// "where the incident is" are two different facts.
  static const Color _liveBlue = Color(0xFF2563EB);

  /// True while a camera move we started is in flight. See [_moveCameraTo].
  bool _programmaticMove = false;

  /// The camera the map OPENS on, built exactly once.
  ///
  /// Load-bearing, not a micro-optimisation: `CameraViewportState` compares by
  /// identity, so a fresh instance each build reads to MapWidget as "the caller
  /// wants a different camera" and triggers a transition, undoing whatever the
  /// resident had just panned or zoomed to.
  late final CameraViewportState _initialViewport;

  @override
  void initState() {
    super.initState();
    _initialViewport = CameraViewportState(
      center: _toPoint(widget.selected),
      // Opens WIDE, with the whole subdivision in frame. Starting at street
      // zoom means the resident's first gesture is always a pinch-out to work
      // out where they are.
      zoom: MapConstants.premisesMinZoom,
    );
  }

  @override
  void dispose() {
    _warningTimer?.cancel();
    _noFixTimer?.cancel();
    _dragging.dispose();
    _liveCentre.dispose();
    super.dispose();
  }

  // ── geometry conversion ───────────────────────────────────────────────────
  static Point _toPoint(ll.LatLng p) =>
      Point(coordinates: Position(p.longitude, p.latitude));

  static ll.LatLng _toLatLng(Point p) => ll.LatLng(
        p.coordinates.lat.toDouble(),
        p.coordinates.lng.toDouble(),
      );

  String get _styleUri => _satellite
      ? MapConstants.mapboxStyleUri(MapConstants.styleSatellite)
      : MapConstants.mapboxStyleUri(MapConstants.styleStreet);

  Future<void> _onMapCreated(MapboxMap map) async {
    _map = map;

    // Chrome the design doesn't use. Attribution stays enabled — Mapbox terms
    // require it to remain reachable.
    await map.scaleBar.updateSettings(ScaleBarSettings(enabled: false));
    await map.compass.updateSettings(CompassSettings(enabled: false));

    // Every gesture stated explicitly rather than left to the platform default:
    // the Android and iOS SDKs do not agree on those, and "pinch works on my
    // phone" is exactly the bug that hides in the gap. Deceleration is what
    // makes a drag feel like it has weight instead of stopping dead.
    //
    // Two-finger ROTATE is on here, unlike the dashboard map. A centre-anchored
    // pin does not care about bearing — the viewport centre is the same
    // coordinate whichever way north points — and recentre resets the bearing,
    // so there is a way back from a crooked map. Pitch stays off: tilting moves
    // the horizon and makes the point under the pin genuinely ambiguous.
    await map.gestures.updateSettings(
      GesturesSettings(
        scrollEnabled: true,
        pinchToZoomEnabled: true,
        doubleTapToZoomInEnabled: true,
        doubleTouchToZoomOutEnabled: true,
        quickZoomEnabled: true,
        pinchPanEnabled: true,
        scrollMode: ScrollMode.HORIZONTAL_AND_VERTICAL,
        scrollDecelerationEnabled: true,
        pinchToZoomDecelerationEnabled: true,
        rotateDecelerationEnabled: true,
        rotateEnabled: true,
        simultaneousRotateAndPinchToZoomEnabled: true,
        pitchEnabled: false,
      ),
    );

    // NO CAMERA BOUNDS. NO MINIMUM ZOOM. NO MAXIMUM ZOOM.
    //
    // This map used to clamp the camera centre to the premises box and floor
    // the zoom, so a resident could not pull back to see which barangay road
    // they were beside. Orientation is most of the work of pinning, and the
    // constraint was fighting the task.
    //
    // Dropping them does NOT let anyone file against a neighbouring property.
    // The real guard is the point-in-polygon check on commit (see
    // [_onMapIdle]), which rejects a pin outside the premises no matter where
    // the camera can travel.
    //
    // The ceiling went too. Past ~19 the vector tiles carry no new detail, so
    // the cap was defensible — but it also meant a pinch that had been
    // magnifying suddenly stopped dead with fingers still moving, which reads
    // as the map having frozen rather than as having run out of data. Mapbox
    // over-zooms past the last tile level by scaling it, so the map keeps
    // responding; it just gets softer, which is legible as "no more detail".
    //
    // `infiniteBounds` explicitly, rather than not calling setBounds at all:
    // the SDK carries its own defaults and this states the intent in code.
    await map.setBounds(
      CameraBoundsOptions(
        bounds: CoordinateBounds(
          southwest: _toPoint(const ll.LatLng(-90, -180)),
          northeast: _toPoint(const ll.LatLng(90, 180)),
          infiniteBounds: true,
        ),
      ),
    );

    // NO TAP-TO-PLACE. Deliberately not registering a TapInteraction — see the
    // class doc.

    await _enableLiveLocation();
    await _buildAnnotations();
  }

  /// The resident's own position, as a live pulsing puck.
  ///
  /// Mapbox's location component subscribes to the platform location stream
  /// itself, so the puck follows without this widget polling or holding a
  /// subscription to leak. A denial is not an error: pinning still works, the
  /// resident just places the pin by eye.
  Future<void> _enableLiveLocation() async {
    final map = _map;
    if (map == null) return;

    try {
      if (!await geo.Geolocator.isLocationServiceEnabled()) return;
      var perm = await geo.Geolocator.checkPermission();
      if (perm == geo.LocationPermission.denied) {
        perm = await geo.Geolocator.requestPermission();
      }
      if (perm == geo.LocationPermission.denied ||
          perm == geo.LocationPermission.deniedForever) {
        return;
      }
      if (!mounted) return;

      await map.location.updateSettings(
        LocationComponentSettings(
          enabled: true,
          pulsingEnabled: true,
          pulsingColor: _liveBlue.toARGB32(),
          showAccuracyRing: true,
          accuracyRingColor: _liveBlue.withValues(alpha: 0.16).toARGB32(),
          accuracyRingBorderColor:
              _liveBlue.withValues(alpha: 0.40).toARGB32(),
        ),
      );
      if (mounted) setState(() => _hasLiveLocation = true);
    } catch (_) {
      // Location is an enhancement here, never a precondition for pinning.
    }
  }

  /// Moves the camera to the resident's GPS fix and drops the pin there.
  ///
  /// Both, not just the camera: the button means "use my location", and a
  /// recentre that moved the view but left the pin behind would be the most
  /// confusing possible outcome on a screen whose job is placing a pin.
  Future<void> _recenterOnMe() async {
    final map = _map;
    if (map == null) return;

    // The button is always on screen, so this is also where permission gets
    // asked for. Tapping "my location" IS the consent moment.
    if (!_hasLiveLocation) {
      await _enableLiveLocation();
      if (!mounted) return;
    }

    try {
      final pos = await geo.Geolocator.getCurrentPosition(
        desiredAccuracy: geo.LocationAccuracy.high,
      ).timeout(const Duration(seconds: 5));
      final here = ll.LatLng(pos.latitude, pos.longitude);

      // Outside the premises, centre but do not pin — an incident cannot be
      // filed against a lot the resident is not standing in.
      final inside = MapConstants.containsInSubdivision(here);
      await _moveCameraTo(here, duration: 420);
      if (!mounted) return;
      if (inside) {
        widget.onChanged(here);
      } else {
        _showOutOfBounds();
      }
    } catch (_) {
      // Services off, permission refused, or nothing acquired indoors inside
      // the timeout. Say so rather than letting the tap look ignored.
      if (mounted) _showNoFix();
    }
  }

  void _showNoFix() {
    setState(() => _showNoLocation = true);
    _noFixTimer?.cancel();
    _noFixTimer = Timer(const Duration(seconds: 4), () {
      if (mounted) setState(() => _showNoLocation = false);
    });
  }

  /// Annotation managers are owned by the style, so they do not survive a
  /// `loadStyleURI` call and must be recreated whenever the basemap changes.
  Future<void> _buildAnnotations() async {
    final map = _map;
    if (map == null) return;

    // One manager for one line.
    _boundaryCore = await map.annotations.createPolylineAnnotationManager();
    await _drawBoundary();

    // Order matters: circles first, so the labels' layer sits above the dots
    // and a label is never hidden behind a neighbouring lot's marker.
    _lotDots = await map.annotations.createCircleAnnotationManager();
    _lotLabels = await map.annotations.createPointAnnotationManager();

    if (!LotReferenceStore.isLoaded) await LotReferenceStore.load();
    if (!mounted) return;
    await _refreshNearbyLots(widget.selected);
  }

  /// Redraws the nearby-lot tags around [centre].
  ///
  /// Deletes and recreates rather than diffing: the set is at most four
  /// annotations and this runs when the camera stops, so the simple version
  /// costs nothing worth the bug surface of an incremental update.
  ///
  /// Quiet by design when the reference table is empty — which it is until the
  /// estate supplies lot coordinates. No tags appear, and the pin badge falls
  /// back to naming the phase.
  Future<void> _refreshNearbyLots(ll.LatLng centre) async {
    final dots = _lotDots;
    final labels = _lotLabels;
    if (dots == null || labels == null) return;
    if (_refreshingLots) return;
    _refreshingLots = true;

    try {
      await dots.deleteAll();
      await labels.deleteAll();

      final locator = LotReferenceStore.locator;
      if (locator.isEmpty) return;

      // The lot the badge is already naming is excluded — it is the primary
      // marker at the centre of the screen, and drawing it a second time as a
      // secondary tag is the map telling the resident the same thing twice.
      final resolved = locator.resolve(centre);
      final nearby = locator
          .nearby(centre)
          .where((m) => m.address != resolved?.address)
          .toList();
      if (nearby.isEmpty) return;

      for (final match in nearby) {
        final point = _toPoint(match.point.centre);
        await dots.create(
          CircleAnnotationOptions(
            geometry: point,
            circleRadius: 5,
            circleColor: AppColors.primaryDark.toARGB32(),
            circleStrokeWidth: 2,
            circleStrokeColor: AppColors.onAccent.toARGB32(),
          ),
        );
        await labels.create(
          PointAnnotationOptions(
            geometry: point,
            textField: match.address.shortLabel,
            textSize: 11,
            textColor: AppColors.textPrimary.toARGB32(),
            // A white halo rather than a filled plate: these sit on satellite
            // imagery, and a halo keeps the text legible over foliage without
            // covering the roof the resident is trying to identify.
            textHaloColor: AppColors.onAccent.toARGB32(),
            textHaloWidth: 1.6,
            textAnchor: TextAnchor.BOTTOM,
            // Ems, not pixels. Lifts the label clear of its own dot.
            textOffset: [0, -0.9],
          ),
        );
      }
    } catch (_) {
      // The style can be swapped out from under an in-flight refresh. Losing
      // the tags is not worth interrupting the report.
    } finally {
      _refreshingLots = false;
    }
  }

  Future<void> _drawBoundary() async {
    final source = MapConstants.subdivisionBoundary;
    if (source.length < 4) return;

    final ring = source.map(_toPoint).map((p) => p.coordinates).toList();
    // A GeoJSON linear ring must repeat its first position. The canonical asset
    // already does, but the rectangular fallback in MapConstants may not.
    if (ring.first.lat != ring.last.lat || ring.first.lng != ring.last.lng) {
      ring.add(ring.first);
    }

    // ── ONE LINE. No fill, no halo, no outer square. ────────────────────────
    //
    // Everything else that used to be drawn here shaded the imagery a resident
    // reads to find the spot they are reporting: a 5% interior tint, an 8px
    // glow casing three times the width of the line it supported, and an outer
    // bounding-box frame that only raised the question of which boundary the
    // rule followed.
    //
    // The trade: a 2px emerald stroke can lose itself against dark foliage. If
    // that bites, the fix is a thin WHITE casing either side rather than
    // bringing the coloured bloom back — white separates the line from the
    // imagery without tinting it.
    //
    // PARITY NOTE: the oxblood/gold two-stroke this once carried mirrored
    // BOUNDARY_STYLE in `web-portal/src/shared/lib/subdivisionBoundary.js`, so
    // this picker no longer matches the dispatcher's map on COLOUR. The
    // geometry is still the shared GeoJSON, which is the part that must agree.
    await _boundaryCore?.create(
      PolylineAnnotationOptions(
        geometry: LineString(coordinates: ring),
        lineColor: AppColors.accentPrimary.toARGB32(),
        lineWidth: 2,
        lineJoin: LineJoin.ROUND,
      ),
    );
  }

  /// Moves the camera without letting the move be mistaken for a user drag.
  ///
  /// Every programmatic camera change ends in an idle event that looks exactly
  /// like the end of a finger drag. Committing on that would close a loop —
  /// commit fires onChanged, the parent rebuilds, the camera eases, idle fires,
  /// commit again — so the flag tells [_onMapIdle] to sit this one out.
  Future<void> _moveCameraTo(ll.LatLng target, {int duration = 380}) async {
    final map = _map;
    if (map == null) return;
    _programmaticMove = true;
    try {
      await map.easeTo(
        // Bearing back to north. Rotate is enabled, so this doubles as the way
        // out of a map the resident has twisted and cannot straighten by hand.
        CameraOptions(center: _toPoint(target), bearing: 0),
        MapAnimationOptions(duration: duration),
      );
    } catch (_) {
      _programmaticMove = false;
    }
  }

  /// Lifts the pin the instant a finger MOVES, not when the map reports back.
  ///
  /// The lift used to be triggered by the first camera-change event, which
  /// arrives from the native view over a platform channel — a round trip the
  /// finger has already outrun, so the pin visibly lagged the drag. A
  /// [Listener] sees Flutter's own pointer stream with no channel hop and no
  /// arena to win, and does not claim the gesture, so the map's
  /// EagerGestureRecognizer still gets everything.
  void _onPointerMove(PointerMoveEvent event) => _dragging.value = true;

  /// A finger DOWN on the map plants the pin, before it has moved: the brief's
  /// Grab behaviour stops the idle bounce the moment the screen is touched.
  void _onPointerDown(PointerDownEvent event) => _dragging.value = true;

  /// Drops the pin early when the drag never actually moved the map — no idle
  /// event is coming in that case, and the pin would stay lifted forever.
  void _onPointerUp(PointerEvent event) {
    if (_pendingCentre == null) _dragging.value = false;
  }

  void _onCameraChanged(CameraChangedEventData event) {
    final centre = _toLatLng(event.cameraState.center);
    _pendingCentre = centre;
    // No setState — see [_dragging] and [_liveCentre]. This only records where
    // the camera got to; the two notifiers repaint the pin badge and the status
    // pill without touching the map subtree.
    _liveCentre.value = centre;
    _dragging.value = true;
  }

  /// Fires once the camera settles. This is where the pin is committed.
  ///
  /// Committing on every camera frame instead would rebuild the whole report
  /// form behind the map sixty times a second.
  void _onMapIdle(MapIdleEventData event) {
    final centre = _pendingCentre;
    _pendingCentre = null;
    _dragging.value = false;

    // Our own easeTo landing, not the resident's finger. Swallow it.
    if (_programmaticMove) {
      _programmaticMove = false;
      return;
    }
    if (centre == null) return;

    // ── GEOFENCE: alert, then snap back ─────────────────────────────────────
    //
    // This used to refuse to commit and show a banner, which left the pin
    // visibly outside the estate while the form quietly held the last valid
    // coordinate — the screen said one thing and the record said another.
    // Returning the camera keeps them in agreement.
    //
    // To the NEAREST PERIMETER POINT, not back to the last valid pin. A
    // resident who drags just past the fence meant "here, at the edge" — the
    // gate, the road frontage — and returning them to wherever the pin was
    // before threw that intent away and made them drag the whole way again.
    if (!MapConstants.containsInSubdivision(centre)) {
      HapticFeedback.heavyImpact();
      _showOutOfBounds();
      final snapped = MapConstants.clampToSubdivision(centre);
      // Before the polygon loads, the box clamp can itself land outside the
      // ring; the last valid pin is then the only coordinate known good.
      final target = MapConstants.containsInSubdivision(snapped)
          ? snapped
          : widget.selected;
      // Put the read-out on the coordinate the camera is moving to, so the
      // badge does not sit on "Outside Monticello Villas" after the snap.
      _liveCentre.value = target;
      _moveCameraTo(target, duration: 420);
      if (target != widget.selected) {
        widget.onChanged(target);
        unawaited(_refreshNearbyLots(target));
      }
      return;
    }

    if (centre == widget.selected) return;
    HapticFeedback.selectionClick();
    if (mounted) setState(() => _showWarning = false);
    widget.onChanged(centre);
    // Fire and forget: the tags are decoration on a commit that has already
    // happened, and awaiting them here would hold up the form's rebuild.
    unawaited(_refreshNearbyLots(centre));
  }

  /// Raises the out-of-coverage alert.
  ///
  /// A banner inside the map rather than a SnackBar or dialog: a dialog demands
  /// dismissal for something the map is already correcting, and a SnackBar
  /// appears at the bottom of the SCREEN, detached from the map and possibly
  /// behind the keyboard.
  void _showOutOfBounds() {
    if (!mounted) return;
    setState(() => _showWarning = true);
    _warningTimer?.cancel();
    _warningTimer = Timer(const Duration(seconds: 4), () {
      if (mounted) setState(() => _showWarning = false);
    });
  }

  Future<void> _toggleStyle() async {
    setState(() => _satellite = !_satellite);
    await _map?.loadStyleURI(_styleUri);
    // The style swap discards the previous managers; rebuild onto the new one.
    await _buildAnnotations();
  }

  @override
  void didUpdateWidget(IncidentMapPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.selected == oldWidget.selected) return;

    // ── A SELECTION MADE SOMEWHERE ELSE ─────────────────────────────────────
    //
    // Nothing is redrawn on the map itself — the pin is a widget fixed at the
    // viewport centre, so the only way to reflect a coordinate set from
    // outside is to move the CAMERA under it.
    //
    // This is what makes picking a lot in the search field take the map there.
    // Before it, choosing "Phase 2, Block 4, Lot 12" updated the badge tethered
    // to the pin while the pin itself stayed wherever it had been left, so the
    // label and the coordinate underneath it disagreed until the resident
    // dragged the map to fix it by hand.
    //
    // The guard is what keeps this from fighting the resident's own drag. A
    // finger-driven commit runs `onChanged` → parent setState → back here as a
    // new `selected`, and easing to a coordinate the camera is already on
    // would restart the whole cycle. [_liveCentre] holds where the camera
    // actually settled, so a round trip is recognised and ignored.
    if (_liveCentre.value == widget.selected) return;
    _liveCentre.value = widget.selected;
    _moveCameraTo(widget.selected, duration: 520);
  }

  @override
  Widget build(BuildContext context) {
    // `mapbox_maps_flutter` has no web implementation — its MapWidget is a
    // native platform view that cannot be created in a browser. Rather than a
    // dead grey rectangle under `flutter run -d chrome`, fall back to the
    // raster-tile picker, which draws the SAME Mapbox styles server-side.
    if (kIsWeb) {
      return SubdivisionMapPicker(
        selected: widget.selected,
        onChanged: widget.onChanged,
        height: widget.height,
        showHint: widget.showHint,
        radarColor: widget.radarColor,
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: SizedBox(
        height: widget.height,
        width: double.infinity,
        child: Stack(
          children: [
            // Listener, not GestureDetector: it observes the pointer stream
            // without entering the gesture arena, so the eager recognizer below
            // is unaffected. This is what makes the pin's lift land on the same
            // frame as the finger.
            Listener(
              onPointerDown: _onPointerDown,
              onPointerMove: _onPointerMove,
              onPointerUp: _onPointerUp,
              onPointerCancel: _onPointerUp,
              child: MapWidget(
                key: const ValueKey('incident-map-picker'),
                styleUri: _styleUri,
                // The ONE stable instance — see [_initialViewport].
                viewport: _initialViewport,
                // The first frame's camera, set natively at creation — the
                // viewport is only applied once the platform view exists, and
                // until then Mapbox drew its default world view.
                // ignore: deprecated_member_use
                cameraOptions: CameraOptions(
                  center: _toPoint(widget.selected),
                  zoom: MapConstants.premisesMinZoom,
                ),
                onMapCreated: _onMapCreated,
                onCameraChangeListener: _onCameraChanged,
                onMapIdleListener: _onMapIdle,
                // ── THE FROZEN-MAP FIX ──────────────────────────────────────
                //
                // Without this the map cannot be dragged at all. This picker
                // lives inside the report step's SingleChildScrollView, and
                // MapWidget's own docs are explicit: with no gestureRecognizers
                // "the map will only handle pointer events for gestures that
                // were not claimed by any other gesture recognizer." The scroll
                // view's vertical drag recognizer claims every drag first, so
                // the platform view was handed nothing.
                //
                // EagerGestureRecognizer claims on the first pointer event
                // rather than waiting to win an arena, which is what a map
                // needs: pan, pinch and rotate all begin as an ambiguous drag.
                // The cost is that the page can no longer be scrolled by
                // dragging ON the map — correct for an interactive map, and the
                // form scrolls from anywhere else.
                gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
                  Factory<OneSequenceGestureRecognizer>(
                      () => EagerGestureRecognizer()),
                },
              ),
            ),

            // The pin, fixed to the viewport centre — not in the map's
            // coordinate space at all. ValueListenableBuilder so the lift
            // rebuilds ONLY this subtree; rebuilding the parent would rebuild
            // MapWidget with it.
            IgnorePointer(
              child: Center(
                child: ValueListenableBuilder<bool>(
                  valueListenable: _dragging,
                  builder: (context, dragging, _) =>
                      _CentrePin(moving: dragging, color: widget.radarColor),
                ),
              ),
            ),

            // The scroll/pan arbiter — a full-bleed scrim that swallowed the
            // first touch — and the "Tap to move the pin" chip that turned it
            // off both stood here. Nothing replaces them: the map is live, so
            // there is nothing between the finger and the platform view.

            // Two controls in a compact vertical stack on the right edge, the
            // same arrangement as the dashboard map. Top-right: the warning
            // bars use the bottom edge, and at 36px wide the stack stays well
            // clear of the pin in the middle.
            Positioned(
              right: _controlInset,
              top: _controlInset,
              child: MapControlCluster(
                children: [
                  MapControlButton(
                    icon: _satellite
                        ? MapActionIcons.toStreets
                        : MapActionIcons.toSatellite,
                    tooltip: _satellite
                        ? 'Switch to Streets'
                        : 'Switch to Satellite',
                    onTap: _toggleStyle,
                  ),
                  MapControlButton(
                    icon: MapActionIcons.currentLocation,
                    tooltip: 'Recenter to my location',
                    onTap: _recenterOnMe,
                  ),
                ],
              ),
            ),

            // ── THE STATUS PILL ─────────────────────────────────────────────
            //
            // Two states, and it is HIDDEN the rest of the time. It teaches the
            // drag before the map has been moved, and it warns when the pin has
            // left the estate.
            //
            // It used to fill the gap between those with "Pin placed — enter
            // the address below", which was the auto-address prompt wearing a
            // different hat: a nag, from the middle of the frame, about a field
            // already visible below. An empty slot says the same thing.
            //
            // Content-sized rather than full-bleed, so the satellite imagery
            // either side of it stays readable.
            if (widget.showHint)
              Positioned(
                left: AppSpacing.sm,
                // Clear of the control stack on the right edge.
                right: _controlInset + MapControlButton.size + AppSpacing.sm,
                top: AppSpacing.sm,
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: ValueListenableBuilder<ll.LatLng?>(
                    valueListenable: _liveCentre,
                    builder: (context, live, _) {
                      final outside = live != null &&
                          !MapConstants.containsInSubdivision(live);
                      // The hint no longer waits on the map being woken —
                      // there is nothing to wake. It shows from the first frame
                      // until the camera first moves, which is exactly the
                      // window in which a resident does not yet know the
                      // gesture.
                      final label = outside
                          ? 'Outside Monticello Villas'
                          : (live == null
                              // Names the primary gesture: dragging the map
                              // under a fixed pin, not tapping at a target the
                              // thumb covers.
                              ? 'Drag the map to place the pin'
                              : null);

                      return AnimatedSwitcher(
                        duration: const Duration(milliseconds: 220),
                        child: label == null
                            ? const SizedBox.shrink()
                            : _GlassBar(
                                key: ValueKey(label),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      outside
                                          ? PhosphorIconsFill.gpsSlash
                                          : PhosphorIconsFill.handGrabbing,
                                      color: widget.radarColor,
                                      size: 16,
                                    ),
                                    const SizedBox(width: 8),
                                    Flexible(
                                      child: Text(
                                        label,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: sfPro(
                                          fontSize: 12,
                                          color: AppColors.textSecondary,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                      );
                    },
                  ),
                ),
              ),

            if (_showNoLocation)
              Positioned(
                left: 8,
                right: 8,
                bottom: 8,
                child: _GlassBar(
                  radius: AppRadius.md,
                  borderColor: AppColors.warning.withValues(alpha: 0.40),
                  child: Row(
                    children: [
                      const Icon(PhosphorIconsFill.gpsSlash,
                          color: AppColors.warning, size: 18),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          "Couldn't get your location. Check that location is "
                          'on, then try again — or place the pin by dragging.',
                          style: sfPro(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textSecondary,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            if (_showWarning)
              Positioned(
                left: 8,
                right: 8,
                bottom: 8,
                child: _GlassBar(
                  radius: AppRadius.md,
                  borderColor: AppColors.danger.withValues(alpha: 0.40),
                  child: Row(
                    children: [
                      const Icon(PhosphorIconsFill.gpsSlash,
                          color: AppColors.danger, size: 18),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Out of coverage',
                              style: sfPro(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                color: AppColors.danger,
                              ),
                            ),
                            Text(
                              // Says what happened AND what the map just did,
                              // because the camera snaps back underneath the
                              // message and that would otherwise look like the
                              // drag simply failed.
                              'Incidents can only be reported inside Monticello '
                              'Villas. Pin moved to the nearest point inside.',
                              style: sfPro(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: AppColors.textSecondary,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The frosted surface every floating overlay on this map sits on.
class _GlassBar extends StatelessWidget {
  const _GlassBar({
    super.key,
    required this.child,
    this.radius = AppRadius.sm,
    this.borderColor,
  });

  final Widget child;
  final double radius;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            // Dense rather than lightly translucent: these sit on SATELLITE
            // imagery, a busy unpredictable backdrop where a thin white loses
            // its text.
            color: AppColors.backgroundSecondary.withValues(alpha: 0.92),
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(
              color: borderColor ?? AppColors.glassBorderLight,
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// The pin, fixed at the viewport centre while the map slides beneath it.
///
/// ── A LOCATION PIN, NOT AN AVATAR ─────────────────────────────────────────
/// A Grab-style pin: a disc in the selected category's colour with a white rim
/// and centre dot, on a thin needle whose foot is the coordinate being
/// reported. It shares the category hue with the hint glyph and the
/// severity chip, so "what happened" and "where" read as one fact.
///
/// ── GRAB-STYLE: BOUNCING AT REST, PLANTED WHILE AIMING ────────────────────
/// Idle, the pin hovers in a slow continuous bounce over a ground shadow that
/// shrinks as it rises — it reads as waiting to be placed. The instant a
/// finger touches the map ([moving]) the bounce stops and the pin snaps down
/// onto its tip in ~90ms, so while aiming the tip is still and exactly on the
/// centre. Released, it settles, holds a beat, and starts bouncing again.
/// Under reduced motion it never bounces: it simply sits on its tip.
///
/// The bounce lifts only the drawing — the tip's resting position, and so the
/// coordinate reported, never moves.
class _CentrePin extends StatefulWidget {
  const _CentrePin({required this.moving, required this.color});

  /// True while a finger is on the map or the camera is moving.
  final bool moving;

  /// The selected category's colour.
  final Color color;

  /// ── 42, AND THE BUDGET THAT SETS IT ──────────────────────────────────────
  ///
  /// This map is 240px tall and carries a badge tethered above the pin, so the
  /// head is capped by how far that badge ends up from the coordinate against
  /// the 120px of viewport above centre. Give the map more height and this is
  /// the number to raise.
  static const double _headSize = 36;

  /// The white rim around the coloured disc.
  static const double _rimWidth = 3;

  /// ── THE GRAB PIN: A HEAD ON A STICK ────────────────────────────────────
  /// A round head on a thin needle, standing on a dot of shadow. The needle's
  /// FOOT is the coordinate — a 3px point is a far more exact thing to aim
  /// than the blunt apex of a triangle under a wide disc, which is the whole
  /// reason Grab's pin is drawn this way.
  static const double _tailHeight = 16;
  static const double _stickWidth = 3;

  /// How high the idle bounce lifts the pin, at its peak.
  static const double bounceHeight = 9;

  /// One full bounce, up and back down.
  static const Duration bouncePeriod = Duration(milliseconds: 1100);

  /// How far the top of the pin head sits above the coordinate under the tip.
  static const double pinHeightAboveCentre = _headSize + _tailHeight;

  /// Height of the whole widget, and the arithmetic that keeps the pin's TIP on
  /// the exact centre of the viewport: content above the tip and the space
  /// below it balance, `head + tail` each.
  static const double _boxHeight = (_headSize + _tailHeight) * 2;

  @override
  State<_CentrePin> createState() => _CentrePinState();
}

class _CentrePinState extends State<_CentrePin>
    with SingleTickerProviderStateMixin {
  /// 0 = resting on the tip, 1 = top of the bounce.
  late final AnimationController _lift = AnimationController(vsync: this);
  Timer? _resume;

  bool get _reduceMotion => MediaQuery.disableAnimationsOf(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(_CentrePin oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.moving != widget.moving) _sync();
  }

  void _sync() {
    _resume?.cancel();
    if (widget.moving || _reduceMotion) {
      // Snap down: the finger is aiming, so the tip must be still.
      _lift.animateTo(0,
          duration: const Duration(milliseconds: 90), curve: Curves.easeOut);
      return;
    }
    // Released: settle, then a beat, then bounce.
    _resume = Timer(const Duration(milliseconds: 350), () {
      if (!mounted || widget.moving) return;
      _lift.repeat(reverse: true, period: _CentrePin.bouncePeriod ~/ 2);
    });
  }

  @override
  void dispose() {
    _resume?.cancel();
    _lift.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color;
    return SizedBox(
      width: _CentrePin._headSize,
      height: _CentrePin._boxHeight,
      child: AnimatedBuilder(
        animation: _lift,
        builder: (context, _) {
          // Eased both ways: slow at the top like something hanging, quicker
          // near the ground like something landing.
          final t = Curves.easeInOutSine.transform(_lift.value);
          final rise = t * _CentrePin.bounceHeight;
          return Stack(
            clipBehavior: Clip.none,
            alignment: Alignment.topCenter,
            children: [
              // Ground shadow on the coordinate: smaller and fainter as the
              // pin rises, which is what sells the height.
              Positioned(
                top: _CentrePin.pinHeightAboveCentre - 2,
                child: Opacity(
                  opacity: 0.35 - 0.2 * t,
                  child: Container(
                    width: 10 - 4 * t,
                    height: 4 - 1.5 * t,
                    decoration: BoxDecoration(
                      color: Colors.black,
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: -rise,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: _CentrePin._headSize,
                      height: _CentrePin._headSize,
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: AppColors.onAccent,
                          width: _CentrePin._rimWidth,
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: AppColors.shadowMedium,
                            blurRadius: 8,
                            offset: Offset(0, 2),
                          ),
                        ],
                      ),
                      alignment: Alignment.center,
                      // The centre dot: the classic pin's "here", and what
                      // keeps a dark category colour from reading as a hole.
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: const BoxDecoration(
                          color: AppColors.onAccent,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                    // The needle, tucked 2px up under the head so the join has
                    // no gap, rounded at the foot. Its bottom is the
                    // coordinate.
                    Transform.translate(
                      offset: const Offset(0, -2),
                      child: Container(
                        width: _CentrePin._stickWidth,
                        height: _CentrePin._tailHeight + 2,
                        decoration: BoxDecoration(
                          color: Color.lerp(color, Colors.black, 0.25),
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
