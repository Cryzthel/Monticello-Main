import 'dart:async';

import 'package:flutter/foundation.dart' show Factory, kIsWeb;
import 'package:flutter/gestures.dart'
    show EagerGestureRecognizer, OneSequenceGestureRecognizer;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
// Prefixed: both packages export a `LocationSettings`, and geolocator's
// `LocationAccuracy` would shadow Mapbox's puck types unqualified.
import 'package:geolocator/geolocator.dart' as geo;
import 'package:latlong2/latlong.dart' as ll;
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

import 'package:monticello_villas_app/core/config/map_constants.dart';
import 'package:monticello_villas_app/core/location/device_heading.dart';
import 'package:monticello_villas_app/core/location/location_access.dart';
import 'package:monticello_villas_app/core/location/location_status_chip.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/bounded_map_widget.dart';
import 'package:monticello_villas_app/core/widgets/map_controls.dart';
import 'package:monticello_villas_app/features/map/widgets/geofenced_map_card.dart';
import 'package:monticello_villas_app/features/map/widgets/live_location_marker.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';

/// The dashboard's embedded subdivision map.
///
/// Renders through the native Mapbox SDK (`mapbox_maps_flutter`), so the
/// homepage shows the same vector styles the web dashboards' Mapbox GL JS maps
/// do — not pre-rendered raster tiles of them. The subdivision perimeter is a
/// real map layer built from the shared GeoJSON asset
/// (`assets/geo/monticello_villas_boundary.geojson`), which is the same file
/// the React portals read, so the boundary drawn here is byte-for-byte the
/// boundary a dispatcher sees.
///
/// Bounds come from [BoundedMapWidget] rather than being reimplemented: a map
/// handed an unbounded height constraint (which is what a Column or scroll view
/// passes down) can collapse the surrounding layout to a sliver. That wrapper
/// pins a finite height and isolates a build failure to this card.
/// VIEWING SURFACE ONLY. This card reports where the resident is; it does not
/// start workflows. The "Report here" action that used to float over the
/// bottom-right corner is gone, and with it the card's dual role — filing an
/// incident now lives solely on the Reports flow, where the full wizard can
/// validate a category, a pin and evidence together. A map whose primary
/// gesture target is a submit button is also a map you cannot pan to the corner
/// it covers.
class HomepageMapboxCard extends StatefulWidget {
  const HomepageMapboxCard({
    super.key,
    this.height = 240,
    this.margin = EdgeInsets.zero,
    this.boxed = true,
    this.overlayInset = EdgeInsets.zero,
    this.cameraPadding = EdgeInsets.zero,
  });

  /// The part of the map hidden behind things floating over it — the header
  /// above, the announcements sheet below. When the camera centres on the
  /// resident it centres in what is LEFT, so the marker lands on visible
  /// imagery rather than under the sheet at the map's geometric middle.
  final EdgeInsets cameraPadding;

  /// Extra clearance for the floating overlay — the premises pill and the two
  /// map controls — on top of the overlay's own 10px margin.
  ///
  /// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
  /// On the dashboard this map is a FULL-BLEED layer running the whole height
  /// of the screen, with the green header floating on top of it as a sibling.
  /// That is deliberate — it is what puts imagery behind the header's rounded
  /// bottom corners instead of two white notches — but it means the map's own
  /// top edge is somewhere behind an opaque bar.
  ///
  /// The overlay aligned itself to that edge, so the layer toggle, the recentre
  /// button and the premises chip were all being drawn UNDERNEATH the header
  /// and were invisible on the one screen that uses this card. Nothing was
  /// missing and nothing had failed; the controls were painted a hundred
  /// pixels above where anyone could see them.
  ///
  /// The caller supplies the clearance because only the caller knows what is
  /// floating over the map. It is measured rather than assumed — see
  /// `_HomeTabState._measureHeader` — so the buttons stay clear of the header
  /// at any status-bar height, text scale or screen size.
  final EdgeInsets overlayInset;

  final double height;

  /// Inset around the boxed container. The dashboard passes its screen gutter
  /// here so the card's border and shadow have room to read as a card — a
  /// bordered box flush to the viewport edge is indistinguishable from a
  /// full-bleed map with a line drawn on it.
  final EdgeInsetsGeometry margin;

  /// Whether to draw the card's frame — border, corner radius and shadow.
  ///
  /// False when the map is the dashboard's BACKDROP, running edge to edge under
  /// the announcements sheet. A frame there would be a rounded rectangle
  /// hairlined against the viewport's own edges and half-covered by the sheet:
  /// chrome describing a boundary the layout does not have. The bounds, gesture
  /// set and error boundary are unaffected — only the frame is dropped.
  final bool boxed;

  @override
  State<HomepageMapboxCard> createState() => _HomepageMapboxCardState();
}

class _HomepageMapboxCardState extends State<HomepageMapboxCard>
    with WidgetsBindingObserver {
  MapboxMap? _map;

  /// Where the camera is told to be. HELD, not built inline in [build]: the
  /// MapWidget compares viewports by identity and re-runs the transition for
  /// every new instance, so `viewport: CameraViewportState(...)` written in
  /// build snapped the camera back to the opening frame on EVERY setState —
  /// a basemap toggle, a permission change, the chip appearing. Only the two
  /// camera buttons and the first live fix replace it.
  ViewportState _viewport = CameraViewportState(
    center: _toPoint(MapConstants.premisesCenter),
    zoom: MapConstants.premisesMinZoom,
  );

  /// Where location access stands. Null until the first check answers, so the
  /// status chip never flashes "Location is off" on a phone that has it on.
  LocationAccess? _access;

  /// True while the system permission prompt is up, so the resume it causes
  /// (the prompt is its own activity on Android) does not re-enter the flow.
  bool _requesting = false;

  /// Follows the device's location switch, so turning it on from the quick
  /// settings shade brings the pin up without a restart.
  StreamSubscription<geo.ServiceStatus>? _serviceSub;

  /// The platform's reduced-motion setting, cached for the same reason as
  /// [_pixelRatio]. Turns off the camera glides.
  bool _reduceMotion = false;

  /// Whether the phone has a compass. Null until asked; see [DeviceHeading].
  bool? _hasHeading;

  /// The subdivision perimeter — one stroke, no fill. See [_drawBoundary].
  PolylineAnnotationManager? _boundaryCore;

  /// What the puck is currently showing, so a refresh that would send
  /// identical images is skipped. Cleared whenever the style is rebuilt.
  String? _markerKey;

  /// Serialises puck refreshes so two can never interleave.
  bool _refreshing = false;
  bool _refreshPending = false;

  /// The heading beam, painted once per pixel ratio.
  Uint8List? _coneBytes;
  double? _coneRatio;

  /// Satellite by default.
  ///
  /// A street basemap of a subdivision is mostly empty road casing — the
  /// resident already knows the street names. Imagery is what makes a specific
  /// house findable, which is the job this card actually does.
  bool _satellite = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // The permission prompt goes up on the FIRST FRAME, not after the map.
    // It used to wait for the platform view to be created, the camera to be
    // framed and the boundary to be drawn — a second or two of map loading
    // between opening the screen and the OS dialog. Nothing about asking needs
    // the map; whatever the answer, the map picks it up when it is ready
    // ([_buildLayers] draws the puck from [_access], and the follow camera is
    // applied as soon as the platform view exists).
    if (!kIsWeb) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_initLocation());
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _serviceSub?.cancel();
    super.dispose();
  }

  /// Back from Settings, or from the system prompt's own activity: the answer
  /// may have changed while the app was away, and nothing else will tell us.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_requesting) {
      unawaited(_refreshAccess());
    }
  }

  /// The screen's pixel ratio, read HERE and cached.
  ///
  /// ── WHY THIS IS NOT READ WHERE IT IS USED ────────────────────────────────
  /// [_renderMarker] needs it to rasterise the pin, and it used to call
  /// `MediaQuery.of(context)` inline. That crashed the app:
  ///
  ///     'framework.dart': Failed assertion: '_dependents.isEmpty': is not true
  ///
  /// `MediaQuery.of` does not just read a value — it REGISTERS this element as
  /// a dependent of the MediaQuery [InheritedElement]. Doing that from inside
  /// `build` is fine, because the framework unwinds the registration when the
  /// element deactivates. [_renderMarker] is not build: it runs from a
  /// one-minute timer and from async
  /// continuations after the platform view answers. Any of those can fire while
  /// this element is deactivated — `mounted` is still true then — and the
  /// dependency registered at that moment is never unwound. The next time the
  /// MediaQuery element deactivates it finds a stale dependent and asserts.
  ///
  /// [didChangeDependencies] is the sanctioned place to depend on an inherited
  /// widget: it is called on mount and again whenever the MediaQuery changes,
  /// so the cached value stays correct across rotation, a keyboard opening, or
  /// a move to another display — and nothing outside the build pipeline ever
  /// touches an InheritedWidget again.
  double _pixelRatio = 3;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduceMotion = MediaQuery.disableAnimationsOf(context);
    final ratio = MediaQuery.devicePixelRatioOf(context);
    if (ratio == _pixelRatio) return;
    _pixelRatio = ratio;
    // The pin is a bitmap baked at that ratio, so a change means the one on
    // screen is now the wrong resolution. Repaint it.
    unawaited(_refreshMarker());
  }

  static Point _toPoint(ll.LatLng p) =>
      Point(coordinates: Position(p.longitude, p.latitude));

  String get _styleUri => _satellite
      ? MapConstants.mapboxStyleUri(MapConstants.styleSatellite)
      : MapConstants.mapboxStyleUri(MapConstants.styleStreet);

  Future<void> _onMapCreated(MapboxMap map) async {
    _map = map;

    // Chrome the card design doesn't use. Attribution stays enabled — Mapbox
    // terms require it to remain reachable.
    await map.scaleBar.updateSettings(ScaleBarSettings(enabled: false));
    await map.compass.updateSettings(CompassSettings(enabled: false));

    // Every navigation gesture stated explicitly rather than left to the
    // platform default, because the defaults differ between the Android and
    // iOS SDKs and "pinch works on my phone" is exactly the bug that hides in
    // that gap. Pan, pinch, double-tap-in, two-finger-tap-out and quick-zoom
    // (double-tap-hold-drag) are the full set a one-handed viewer expects.
    //
    // Rotate and pitch stay off: both put the camera into a state the resident
    // cannot undo from a 240px box with no reset control, and a north-up plan
    // view is the only orientation the subdivision boundary reads correctly in.
    await map.gestures.updateSettings(
      GesturesSettings(
        scrollEnabled: true,
        pinchToZoomEnabled: true,
        doubleTapToZoomInEnabled: true,
        doubleTouchToZoomOutEnabled: true,
        quickZoomEnabled: true,
        pinchPanEnabled: true,
        // Swiping is unrestricted on both axes. Stated rather than assumed for
        // the same reason as the rest: the default is already this, but a
        // scrollMode left null is a default someone else can change.
        scrollMode: ScrollMode.HORIZONTAL_AND_VERTICAL,
        // Momentum after the finger lifts — the difference between a map that
        // feels native and one that feels like it is redrawing on every frame.
        scrollDecelerationEnabled: true,
        pinchToZoomDecelerationEnabled: true,
        rotateEnabled: false,
        pitchEnabled: false,
        // With rotate off this is belt and braces, but a two-finger zoom that
        // twists a few degrees can still nudge the bearing on some SDK builds,
        // and a boundary that reads north-up everywhere else must here too.
        simultaneousRotateAndPinchToZoomEnabled: false,
      ),
    );

    await _frameOnPremises(map);
    await _buildLayers();
  }

  /// Location on the first frame: straight to the OS.
  ///
  /// No in-app pre-prompt. If the system prompt can still be shown it is shown
  /// now; whatever the resident answers, the map stays fully usable. Granted
  /// brings up the pin. Anything else leaves the map without one and puts the
  /// small [LocationStatusChip] over it — no modal, nothing to dismiss.
  ///
  /// On Android "denied" is asked again on the next visit, because the OS
  /// allows it; after the second refusal Android itself stops showing the
  /// prompt and reports permanently denied, and the chip switches to Settings.
  Future<void> _initLocation() async {
    _watchServiceStatus();
    final access = await _refreshAccess();
    if (!mounted || access == null || !access.canPrompt) return;
    await _resolveAccess(access);
  }

  /// Re-reads access without prompting and brings the map in line with it.
  Future<LocationAccess?> _refreshAccess() async {
    final access = await LocationAccessService.check();
    if (!mounted) return null;
    await _applyAccess(access);
    return access;
  }

  Future<void> _applyAccess(LocationAccess access) async {
    final was = _access;
    if (was == access) return;
    setState(() => _access = access);
    // Camera first, marker second: the follow transition is a widget-level
    // change that needs no platform round trip, so it is queued before the
    // puck images are painted and sent — the snap never waits on a bitmap.
    //
    // Every time location BECOMES available — on load with it already on, or
    // the moment the resident answers "Allow" — the camera goes to them with
    // no further tap. Follow mode waits for the puck's first fix, so it never
    // centres on a guess; a gesture hands the camera back. Approximate →
    // precise is not a transition (both are granted), so it does not re-snap
    // a camera the resident may have moved.
    if (access.isGranted && !(was?.isGranted ?? false)) {
      unawaited(_followIfNearEstate());
    }
    await _refreshMarker();
  }

  /// How close the resident must be for the map to follow them on its own.
  static const double _autoFollowRadiusM = 3000;

  /// Follows the resident automatically ONLY when they are at or near the
  /// estate; otherwise the camera stays on Monticello Villas.
  ///
  /// ── THE "MAP OPENS IN A FOREIGN COUNTRY" BUG ────────────────────────────
  /// Following on every grant sent the camera wherever the phone said it
  /// was — on an emulator that is Google's default fix in California, and
  /// for a resident travelling it is wherever they are. Either way the
  /// dashboard of a subdivision map opened on another continent. This map is
  /// about the estate: it now opens on it, and only moves to the resident if
  /// they are within [_autoFollowRadiusM] of it. The locate button still
  /// follows them anywhere, because pressing it asks for exactly that.
  ///
  /// The check reads the phone's cached fix first (instant) and takes a fresh
  /// one only if there is none. No answer means no move.
  Future<void> _followIfNearEstate() async {
    geo.Position? pos;
    try {
      pos = await geo.Geolocator.getLastKnownPosition();
      pos ??= await geo.Geolocator.getCurrentPosition(
        desiredAccuracy: geo.LocationAccuracy.medium,
      ).timeout(const Duration(seconds: 6));
    } catch (_) {
      pos = null;
    }
    if (!mounted || pos == null) return;
    final centre = MapConstants.premisesCenter;
    final metres = geo.Geolocator.distanceBetween(
        pos.latitude, pos.longitude, centre.latitude, centre.longitude);
    if (metres <= _autoFollowRadiusM) _followResident(duration: 650);
  }

  /// The one action each missing state allows — the system prompt, the app's
  /// Settings page, or the location switch. Used by init, the chip and the
  /// locate button alike.
  Future<void> _resolveAccess([LocationAccess? known]) async {
    if (_requesting) return;
    _requesting = true;
    try {
      // Fresh unless just read: the switch may have been flipped from the
      // quick-settings shade since the last check.
      final current = known ?? await LocationAccessService.check();
      if (!mounted) return;
      final after = current.isGranted
          ? current
          : await LocationStatusChip.resolve(current);
      if (!mounted) return;
      await _applyAccess(after);
    } finally {
      _requesting = false;
    }
  }

  void _watchServiceStatus() {
    _serviceSub?.cancel();
    try {
      _serviceSub = geo.Geolocator.getServiceStatusStream().listen(
        (_) => unawaited(_refreshAccess()),
        onError: (_) {},
      );
    } catch (_) {
      // Not every platform reports this; resume checks cover the gap.
    }
  }

  /// Opens the camera on Monticello Villas — Phases 1, 2, 3 and 5.
  ///
  /// FRAMING, NOT A CAGE. This method once set a camera bound and a minimum
  /// zoom to pen the resident inside the village; both are gone (see the
  /// setBounds call at the end). What survives is the opening shot: where the
  /// camera starts, and at what zoom. Everything after the first frame is the
  /// resident's.
  ///
  /// The framing zoom is asked of the map rather than hard-coded, because the
  /// answer depends on the card's real pixel size — the same constant cannot
  /// fit the ring on a 240px card and on a tablet's taller one. The rectangle
  /// is derived from the boundary polygon (see [MapConstants.premisesSouthWest]),
  /// so re-tracing `assets/geo/monticello_villas_boundary.geojson` re-frames
  /// this card with no code change here.
  Future<void> _frameOnPremises(MapboxMap map) async {
    final bounds = CoordinateBounds(
      southwest: _toPoint(MapConstants.premisesSouthWest),
      northeast: _toPoint(MapConstants.premisesNorthEast),
      infiniteBounds: false,
    );

    var frameZoom = MapConstants.premisesMinZoom;
    try {
      final fitted = await map.cameraForCoordinateBounds(
        bounds,
        MbxEdgeInsets(top: 0, left: 0, bottom: 0, right: 0),
        null, // bearing — north-up, matching the disabled rotate gesture
        null, // pitch — plan view, matching the disabled pitch gesture
        MapConstants.maxZoom,
        null,
      );
      final zoom = fitted.zoom;
      // A platform call that fails quietly returns something unusable rather
      // than throwing, and the answer here becomes the camera's MINIMUM — so an
      // implausible one does not merely look wrong, it locks the resident at
      // that zoom with no way to pull back. Only a credible fit is accepted;
      // anything outside the band keeps the documented floor.
      if (zoom != null &&
          zoom.isFinite &&
          zoom >= MapConstants.minZoom &&
          zoom <= MapConstants.premisesMaxFrameZoom) {
        frameZoom = zoom;
      }
    } catch (_) {
      // Keep the documented floor — a coarser frame, never an unbounded one.
    }
    if (!mounted) return;

    // NO LIMITS. Matching the incident picker, which dropped its own bounds
    // and minimum zoom for the same reason: the resident could not pull back
    // to see which road the village sits on, and could not pan to check a
    // corner of it. This card is a viewing surface — nothing is filed from it,
    // so there is no correctness argument for penning the camera in.
    //
    // `infiniteBounds` explicitly, rather than simply not calling setBounds:
    // the previous call may already have installed a bound, and on a style
    // reload this method runs again.
    await map.setBounds(
      CameraBoundsOptions(
        bounds: CoordinateBounds(
          southwest: _toPoint(const ll.LatLng(-90, -180)),
          northeast: _toPoint(const ll.LatLng(90, 180)),
          infiniteBounds: true,
        ),
      ),
    );
    // Open on that exact frame. The widget's initial viewport is a fixed
    // centre/zoom pair chosen before the card's height is known, so it is a
    // starting point, not the framing — this is what makes the village fill
    // the box on first paint instead of after the first gesture.
    // ...unless location was granted before the map finished loading, in
    // which case the camera is already following the resident and framing the
    // village over the top of that would undo the snap.
    if (_viewport is FollowPuckViewportState) return;
    await map.setCamera(
      CameraOptions(
        center: _toPoint(MapConstants.premisesCenter),
        zoom: frameZoom,
      ),
    );
  }

  /// Moves the camera to the resident and keeps it there as they move.
  ///
  /// Without access the tap is a request for it: the one action that can
  /// change the state (system prompt, Settings, or the location switch). If
  /// that still leaves no access, that action WAS the answer to the tap.
  Future<void> _recenterOnMe() async {
    if (_map == null) return;
    HapticFeedback.selectionClick();
    if (!(_access?.isGranted ?? false)) {
      await _resolveAccess();
      if (!mounted || !(_access?.isGranted ?? false)) return;
    }
    _followResident(duration: 420);
  }

  /// Mapbox's follow-puck camera: centred on the SAME position the pin is
  /// drawn at, because it reads the puck rather than a second location
  /// stream. A gesture hands the camera back to the resident (Mapbox drops to
  /// idle on interaction). Centred in the strip left visible between the
  /// header and the sheet — see [HomepageMapboxCard.cameraPadding] — and
  /// north-up, matching the disabled rotate gesture.
  void _followResident({required int duration}) {
    final p = widget.cameraPadding;
    // Mapbox flags the whole viewport API experimental. It is also the only
    // way to give a viewport change a duration — which reduced motion needs
    // to be zero — so the flag is accepted here, in one place.
    // ignore: experimental_member_use
    setStateWithViewportAnimation(
      () => _viewport = FollowPuckViewportState(
        zoom: MapConstants.defaultZoom,
        bearing: const FollowPuckViewportStateBearingConstant(0),
        pitch: 0,
        padding: MbxEdgeInsets(
          top: p.top,
          left: p.left,
          bottom: p.bottom,
          right: p.right,
        ),
      ),
      transition: EasingViewportTransition(
        duration: Duration(milliseconds: _reduceMotion ? 0 : duration),
      ),
    );
  }

  /// Shows the resident through Mapbox's own location engine, and nothing
  /// else.
  ///
  /// ── ONE ENGINE ────────────────────────────────────────────────────────────
  /// The native location component is the ONLY source of the resident's
  /// position on this map. It runs its own high-accuracy provider at about one
  /// update a second, draws the pin as its puck image, sizes the accuracy ring
  /// in metres from each fix, turns the heading cone with the compass, and
  /// glides between real fixes on the render thread without extrapolating past
  /// the latest one. Dart never sees a coordinate, so there is no listener to
  /// throttle, no setState per fix, and no second marker to disagree with.
  ///
  /// It used to be two: the stock blue puck from Mapbox's provider plus an
  /// avatar annotation placed from geolocator, which on a real phone sat 15–20
  /// m apart. geolocator now only asks for permission and watches the location
  /// switch — Mapbox has no Flutter API for either.
  ///
  /// Not granted → the puck is off and there is no pin at all. The map stays
  /// usable; the chip says what to do.
  Future<void> _refreshMarker() async {
    if (_refreshing) {
      _refreshPending = true;
      return;
    }
    _refreshing = true;
    try {
      do {
        _refreshPending = false;
        await _renderMarker();
      } while (_refreshPending && mounted);
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _renderMarker() async {
    final map = _map;
    if (map == null || !mounted) return;

    final live = _access?.isGranted ?? false;
    if (!live) {
      if (_markerKey == 'off') return;
      try {
        await map.location.updateSettings(LocationComponentSettings(
          enabled: false,
          pulsingEnabled: false,
          showAccuracyRing: false,
        ));
        _markerKey = 'off';
      } catch (_) {
        _markerKey = null;
      }
      return;
    }

    final profile = UserProfileService.instance.profile;
    // Cached, NOT read from the context here — see [_pixelRatio]. This runs
    // from async continuations, and touching an InheritedWidget from there is
    // what crashed the app.
    final ratio = _pixelRatio;
    final initials = LiveLocationMarker.initialsFor(profile?.name);
    _hasHeading ??= await DeviceHeading.isAvailable();
    final heading = _hasHeading!;
    final key = ['live', initials, profile?.photoUrl, ratio, heading].join('|');
    if (key == _markerKey) return;

    try {
      // Resolved before the paint and awaited: the bitmap is baked in one
      // pass. Flutter's image cache makes every call after the first free.
      final photo = await LiveLocationMarker.resolvePhoto(profile?.photoUrl);
      if (!mounted) return;
      final pin = await LiveLocationMarker.paint(
        initials: initials,
        photo: photo,
        pixelRatio: ratio,
      );
      Uint8List cone = Uint8List(0);
      if (heading) {
        if (_coneBytes == null || _coneRatio != ratio) {
          _coneBytes =
              await LiveLocationMarker.paintHeadingCone(pixelRatio: ratio);
          _coneRatio = ratio;
        }
        cone = _coneBytes!;
      }
      if (!mounted || !(_access?.isGranted ?? false)) return;

      await map.location.updateSettings(
        LocationComponentSettings(
          enabled: true,
          // No pulse: the reference pin does not have one, and a repeating
          // ring around a face read as a second marker.
          pulsingEnabled: false,
          showAccuracyRing: true,
          accuracyRingColor:
              LiveLocationMarker.ring.withValues(alpha: 0.14).toARGB32(),
          accuracyRingBorderColor:
              LiveLocationMarker.ring.withValues(alpha: 0.35).toARGB32(),
          // Device heading drives the cone. Off without a compass, so no cone
          // confidently points north on a phone that cannot know.
          puckBearingEnabled: heading,
          puckBearing: PuckBearing.HEADING,
          locationPuck: LocationPuck(
            locationPuck2D: LocationPuck2D(
              topImage: pin.bytes,
              // Empty bytes mean "no image" to both platform mappings — which
              // is what replaces the stock arrow and shadow.
              bearingImage: cone,
              shadowImage: Uint8List(0),
            ),
          ),
        ),
      );
      _markerKey = key;
    } catch (_) {
      // A failed rasterise or a dead platform view must not take the card
      // down; the next refresh tries again from scratch.
      _markerKey = null;
    }
  }

  /// Annotation managers belong to the style, so they do not survive a
  /// `loadStyleURI` call and must be recreated whenever the basemap changes.
  /// The puck's images go with the style too, hence the cleared key.
  Future<void> _buildLayers() async {
    final map = _map;
    if (map == null) return;

    _boundaryCore = await map.annotations.createPolylineAnnotationManager();
    _markerKey = null;

    await _drawBoundary();
    await _refreshMarker();
  }

  Future<void> _drawBoundary() async {
    final source = MapConstants.subdivisionBoundary;
    if (source.length < 4) return;

    final ring = source.map(_toPoint).map((p) => p.coordinates).toList();
    // A GeoJSON linear ring must repeat its first position. The canonical
    // asset already does; the rectangular fallback in MapConstants may not.
    if (ring.first.lat != ring.last.lat || ring.first.lng != ring.last.lng) {
      ring.add(ring.first);
    }

    // ONE LINE, no fill — the same treatment the incident picker uses, so the
    // subdivision looks identical on both maps.
    //
    // Gone: the 7% oxblood interior fill and the gold casing beneath the core.
    // The fill shaded every roof inside the estate, and this card sits under
    // satellite imagery by default, where that is exactly the detail a resident
    // is looking at.
    await _boundaryCore?.create(
      PolylineAnnotationOptions(
        geometry: LineString(coordinates: ring),
        lineColor: AppColors.accentPrimary.toARGB32(),
        lineWidth: 2,
        lineJoin: LineJoin.ROUND,
      ),
    );
  }

  Future<void> _toggleStyle() async {
    HapticFeedback.selectionClick();
    setState(() => _satellite = !_satellite);
    await _map?.loadStyleURI(_styleUri);
    await _buildLayers();
  }

  @override
  Widget build(BuildContext context) {
    // `mapbox_maps_flutter` ships Android and iOS implementations only — its
    // MapWidget is a native platform view that cannot be created in a browser.
    // Fall back to the raster-tile card, which renders the same Mapbox styles
    // server-side, rather than showing a dead rectangle.
    if (kIsWeb) {
      return GeofencedMapCard(height: widget.height, showReadout: false);
    }

    return BoundedMapWidget(
      height: widget.height,
      margin: widget.margin,
      borderRadius: widget.boxed ? AppRadius.xl : 0,
      showBorder: widget.boxed,
      placeholderLabel: 'Map unavailable',
      // A single soft shadow rather than a stack of them: the card sits on the
      // dashboard's gradient, where anything heavier reads as a dark halo
      // instead of elevation. Offset down-only, matching the incident cards.
      shadows: widget.boxed
          ? [
              const BoxShadow(
                color: AppColors.glassShadow,
                blurRadius: 18,
                offset: Offset(0, 8),
              ),
            ]
          : null,
      overlay: _buildOverlay(context),
      child: RepaintBoundary(
        child: MapWidget(
          key: const ValueKey('homepage-mapbox-card'),
          styleUri: _styleUri,
          // GPU-composited texture: the native renderer draws vector tiles
          // straight into it, and Flutter repaints nothing on a pan.
          textureView: true,
          // The held state — see [_viewport] for why never a new one here.
          viewport: _viewport,
          // The FIRST frame's camera, set natively at creation. The viewport
          // above is only applied once the platform view exists, and until
          // then Mapbox drew its default world camera — a flash of ocean and
          // another country before the map jumped to the estate. Deprecated
          // in favour of `viewport`, which cannot do this part.
          // ignore: deprecated_member_use
          cameraOptions: CameraOptions(
            center: _toPoint(MapConstants.premisesCenter),
            zoom: MapConstants.premisesMinZoom,
          ),
          onMapCreated: _onMapCreated,
          // Claims the pointer on first contact instead of waiting out the
          // gesture arena. With no recognizers the platform view is handed a
          // drag only after nothing else claims it, which reads as a map
          // that lags a beat behind the finger. The incident picker does the
          // same for the same reason.
          gestureRecognizers: <Factory<OneSequenceGestureRecognizer>>{
            Factory<OneSequenceGestureRecognizer>(
                () => EagerGestureRecognizer()),
          },
        ),
      ),
    );
  }

  Widget _buildOverlay(BuildContext context) {
    return Padding(
      // 16 on the right (`right-4`) for the control stack; 10 elsewhere.
      padding: const EdgeInsets.fromLTRB(10, 10, 16, 10) + widget.overlayInset,
      child: Stack(
        children: [
          // Location status, top-left — only when access is
          // missing, and only once the first check has answered. The one
          // standing indicator of a state the resident has to act on; tapping
          // it opens the sheet that says how.
          if (_access != null && _access != LocationAccess.granted)
            Align(
              alignment: Alignment.topLeft,
              child: LocationStatusChip(
                access: _access!,
                onTap: _resolveAccess,
              ),
            ),

          // Every control in ONE top-right column.
          //
          // They used to be spread down the right edge — basemap toggle at the
          // top, zoom stack at centre-right. That worked when the map was a
          // self-contained card. As the dashboard's backdrop it is not: the
          // announcements sheet covers the bottom half and can be dragged to
          // cover nearly all of it, so anything below the top strip is a
          // control the resident cannot reach without first closing the panel
          // they were reading. The top-right corner is the only region
          // guaranteed to stay uncovered at every sheet position.
          //
          // Recentre sits in the same stack rather than off on its own because
          // it belongs to the same job: once the camera cannot zoom out past
          // the village, "pull back until I recognise something" stops being
          // available, and this is what replaces it.
          Align(
            alignment: Alignment.topRight,
            // TWO CONTROLS. See MapControlCluster for why the zoom pair, the
            // compass and the fit-village button are gone.
            //
            // Stacked rather than side by side: this card is wider than it is
            // tall, so a row would reach further across the imagery than a
            // column reaches down it.
            child: MapControlCluster(
              children: [
                MapControlButton(
                  icon: _satellite
                      ? MapActionIcons.toStreets
                      : MapActionIcons.toSatellite,
                  tooltip:
                      _satellite ? 'Switch to Streets' : 'Switch to Satellite',
                  onTap: _toggleStyle,
                ),
                // The SAME crosshair the incident picker uses, from the same
                // constant. Two maps, one "find me".
                MapControlButton(
                  icon: MapActionIcons.currentLocation,
                  tooltip: 'Recentre on my location',
                  onTap: _recenterOnMe,
                ),
              ],
            ),
          ),

          // Nothing occupies the bottom edge. That is deliberate: it is where
          // the announcements sheet sits, and the part of the map a thumb rests
          // on while panning the strip that stays visible.
        ],
      ),
    );
  }
}
