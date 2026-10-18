import 'dart:async';
import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart' show Geolocator;
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/features/contact/widgets/hoa_contact_sheet.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/features/settings/services/account_approval_service.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/notifications/push_registration.dart';
import 'package:monticello_villas_app/features/property/services/property_storage.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/app_card.dart';
import 'package:monticello_villas_app/core/widgets/curved_bottom_nav.dart';
import 'package:monticello_villas_app/core/widgets/settings_row.dart';
import 'package:monticello_villas_app/core/widgets/refresh_shell.dart';
import 'package:monticello_villas_app/features/settings/widgets/settings_skeleton.dart';
import 'package:monticello_villas_app/features/home/widgets/homepage_mapbox_card.dart';
import 'package:monticello_villas_app/features/panic_button/widgets/sos_countdown_sheet.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcement_card.dart';
import 'package:monticello_villas_app/features/announcements/widgets/announcements_panel.dart';
import 'package:monticello_villas_app/features/incidents/screens/incidents_screen.dart';
import 'package:monticello_villas_app/features/incidents/widgets/rating_prompt.dart';
import 'package:monticello_villas_app/features/notifications/models/resident_notification.dart';
import 'package:monticello_villas_app/features/legal/legal_content.dart';
import 'package:monticello_villas_app/features/legal/legal_document_view.dart';
import 'package:monticello_villas_app/features/settings/services/session_sign_out.dart';
import 'package:monticello_villas_app/features/settings/widgets/sign_out_dialog.dart';

// THE INVERTED SURFACE IS GONE. This file used to define its own light palette
// — white fill, slate-100 divider, slate-900/600/400 type — because the
// announcements feed lived on a white sheet while the rest of the shell is an
// ultra-dark forest gradient. That made the same notice arrive in two different
// colour systems depending on the route the resident took to it, and it put a
// second, parallel definition of "card fill", "title", "body" and "timestamp"
// in a file that already had AppColors imported.
//
// The feed now renders through the shared AnnouncementCard, which reads
// AppColors directly. Every token below this line is the app's own.

TextStyle _t({
  double size = 15,
  FontWeight weight = FontWeight.w400,
  Color color = AppColors.onGlassPrimary,
  double letterSpacing = 0,
  double height = 1.35,
}) {
  return sfPro(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: letterSpacing,
    height: height,
  );
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _navIndex = 0;

  StreamSubscription<RemoteMessage>? _pushForegroundSub;
  StreamSubscription<RemoteMessage>? _pushOpenedSub;

  @override
  void initState() {
    super.initState();
    UserProfileService.instance.load();
    LocalDataStore.instance.startListening();

    // The shell is the consumer PushRegistration leaves these streams for.
    // A push that arrives while the app is open draws no system notification
    // on Android, so without this it simply vanished.
    _pushForegroundSub =
        PushRegistration.instance.foreground.stream.listen(_showForegroundPush);
    _pushOpenedSub =
        PushRegistration.instance.opened.stream.listen(_openFromPush);
    final launchedBy = PushRegistration.instance.takeInitialMessage();
    if (launchedBy != null) _openFromPush(launchedBy);
  }

  @override
  void dispose() {
    _pushForegroundSub?.cancel();
    _pushOpenedSub?.cancel();
    super.dispose();
  }

  /// Every report push carries `incidentId`; the panic push does not. Those
  /// are the ones with somewhere to go, and History is where the report is.
  bool _pointsAtReport(RemoteMessage message) =>
      (message.data['incidentId'] as String?)?.isNotEmpty ?? false;

  void _openFromPush(RemoteMessage message) {
    // If the stream got here first, the held copy is spent too — otherwise a
    // later rebuild of the shell would replay the launch tap.
    PushRegistration.instance.takeInitialMessage();
    if (!mounted || !_pointsAtReport(message)) return;
    setState(() => _navIndex = 1);
  }

  void _showForegroundPush(RemoteMessage message) {
    if (!mounted) return;
    final title = message.notification?.title;
    final body = message.notification?.body;
    if (title == null && body == null) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 6),
          content: Text([title, body].whereType<String>().join('\n')),
          action: _pointsAtReport(message)
              ? SnackBarAction(
                  label: 'View',
                  onPressed: () => _openFromPush(message),
                )
              : null,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    // Three tab destinations, matching the three selectable slots in the bar.
    // Reports is not here: it pushes the report wizard as a route rather than
    // switching which view the shell is showing.
    //
    // AnnouncementsScreen is no longer in this list at all. It used to sit at
    // index 1 for the Alerts tab; with that tab gone it would have been a dead
    // entry, and it is still reachable as a route — the header's bell
    // (`/notifications`) and the dashboard panel's "See all" (`/announcements`)
    // both push it.
    final pages = [
      const _HomeTab(),
      // `onBack` is what makes the History header's back arrow work. As a tab
      // there is no route to pop, so without it the button was inert.
      IncidentsScreen(onBack: () => setState(() => _navIndex = 0)),
      // No callback here: _SettingsTab has no back arrow of its own — it opens
      // with a plain "Settings" heading — so there is nothing to wire.
      const _SettingsTab(),
    ];

    final shell = AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Container(
          decoration: const BoxDecoration(gradient: AppGradients.shell),
          // STACK, not a Column.
          //
          // As a Column child the nav reserved its own strip of layout, and the
          // 30px the SOS button overhangs by was a band of bare shell gradient
          // running the full width — the light green backing under the bar. The
          // bar now floats over the page, so that band shows the map or the
          // announcements sheet, and the only thing painting behind the white
          // is the content itself.
          //
          // Content clears it via AppSpacing.navClearance, which the
          // announcements feed and every scrolling screen already pad by.
          child: Stack(
            children: [
              Positioned.fill(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 280),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeInCubic,
                  // Subtle fade + lift so tab changes feel smooth and
                  // intentional instead of a hard cross-fade flash.
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: SlideTransition(
                      position: Tween<Offset>(
                        begin: const Offset(0, 0.014),
                        end: Offset.zero,
                      ).animate(animation),
                      child: child,
                    ),
                  ),
                  child: KeyedSubtree(
                    key: ValueKey(_navIndex),
                    child: pages[_navIndex],
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _buildFixedNavBar(context),
              ),
            ],
          ),
        ),
      ),
    );

    // Asks for a 1-5 star rating when the Guardhouse resolves one of this
    // resident's reports. Mounted on the signed-in shell, so it only ever runs
    // for a resident with a live incident feed.
    return RatingPromptHost(child: shell);
  }

  /// The white curved bar: Home and Reports left of the notch, History and
  /// Settings right of it.
  ///
  /// Four tabs, two a side — the even split the notch needs to stay the
  /// midpoint of the row. Contact and Alerts are gone from the bar but not from
  /// the app: the HOA sheet still opens from Settings › Contact HOA office, and
  /// announcements from the dashboard header's bell and the panel's "See all".
  /// Nothing lost an entry point in the trim.
  ///
  /// Dropping from six tabs to four also restores the roomier typography —
  /// [CurvedBottomNav] scales icons and labels back up below five items, so the
  /// labels stop being the constraint they were at six.
  ///
  /// The floating SOS button, its shadow, its accent and the notch that cradles
  /// it are untouched — they live in [CurvedBottomNav] and take no input from
  /// the tab list.
  Widget _buildFixedNavBar(BuildContext context) {
    return CurvedBottomNav(
      // Opens the countdown directly rather than pushing `/panic`. That route
      // is a screen whose big SOS button then has to be pressed a SECOND time
      // to arm the same five seconds — so the emergency control on every screen
      // in the app was really a navigation control, and the alert did not start
      // until the resident found and pressed another button on a screen they
      // had never seen. The sheet arms itself.
      onSos: () => showSosCountdown(context),
      items: [
        CurvedNavItem(
          icon: PhosphorIconsFill.house,
          label: 'Home',
          selected: _navIndex == 0,
          onTap: () => setState(() => _navIndex = 0),
        ),
        CurvedNavItem(
          icon: PhosphorIconsFill.clipboardText,
          label: 'Reports',
          // An action, not a tab: it pushes the incident-report wizard over the
          // current view rather than switching which view that is, so it never
          // takes the selected state.
          onTap: () => Navigator.of(context).pushNamed('/report'),
        ),
        CurvedNavItem(
          icon: PhosphorIconsFill.receipt,
          label: 'History',
          selected: _navIndex == 1,
          onTap: () => setState(() => _navIndex = 1),
        ),
        CurvedNavItem(
          icon: PhosphorIconsFill.gearSix,
          label: 'Settings',
          selected: _navIndex == 2,
          onTap: () => setState(() => _navIndex = 2),
        ),
      ],
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOME TAB — header, boxed subdivision map, announcements module
// ═══════════════════════════════════════════════════════════════════════════════

class _HomeTab extends StatefulWidget {
  const _HomeTab();

  @override
  State<_HomeTab> createState() => _HomeTabState();
}

/// Shared pull-to-refresh handler used across the app's primary screens.
/// Re-subscribes the Firestore listeners and reloads the user profile so a
/// pull-down reliably refreshes the data the page is showing. No artificial
/// delay — the loader stays visible only as long as this genuinely takes.
Future<void> refreshAppData() async {
  // Independent round-trips — run them together instead of one after the
  // other so the loader never waits longer than the slower of the two.
  await Future.wait([
    LocalDataStore.instance.refresh(),
    UserProfileService.instance.load(),
  ]);
}

class _HomeTabState extends State<_HomeTab> {
  /// The property behind the header's address line, LIVE.
  ///
  /// This was a one-shot `_greetingFuture` that read the name and the property
  /// once in [initState] and never again. Both halves are written by the admin
  /// portal now — the registered name is read-only in Edit Profile and the
  /// property is a read-only record in Property Details — so a correction made
  /// by the office reached this header only after the app was killed and
  /// relaunched. Until then the resident was greeted at the wrong lot.
  ///
  /// The name comes from [UserProfileService], which is a snapshot listener for
  /// the same reason; this is the other half.
  late final Stream<PropertyRecord?> _propertyStream;

  // No filter state. The dashboard shows one chronological stream; category
  // filtering lives on the full Announcements screen, where a reader has
  // already committed to browsing rather than glancing.

  /// Live, not a one-shot read. Held in a field rather than built inline in
  /// [build] so a parent rebuild can't tear down and re-subscribe the
  /// listener on every frame.
  late Stream<String> _approvalStream;

  @override
  void initState() {
    super.initState();
    _propertyStream = _watchProperty();
    _approvalStream = _watchApprovalStatus();
  }


  /// ── THE HEADER'S REAL HEIGHT, MEASURED ────────────────────────────────────
  ///
  /// The map is a full-bleed layer running the whole height of the screen and
  /// the header floats on top of it as a sibling, so the map's own top edge is
  /// behind an opaque green bar. Its overlay — the premises chip, the layer
  /// toggle and the recentre button — aligned to that edge, which meant every
  /// one of them was painted underneath the header and could not be seen. The
  /// controls were never missing; they were drawn where nobody could look.
  ///
  /// Measured rather than derived from the header's own constants. A computed
  /// figure would be right until the first time the status bar, the text scale
  /// or the tablet padding moved it, and then wrong silently — the controls
  /// would slide back under the bar with nothing to catch it.
  final GlobalKey _headerKey = GlobalKey();
  double _headerHeight = 0;

  void _measureHeader() {
    final box = _headerKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize || !mounted) return;
    // Epsilon guard: this runs after every frame, and comparing doubles exactly
    // would setState on sub-pixel noise and rebuild forever.
    if ((box.size.height - _headerHeight).abs() < 0.5) return;
    setState(() => _headerHeight = box.size.height);
  }

  Stream<PropertyRecord?> _watchProperty() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return const Stream<PropertyRecord?>.empty();
    return PropertyStorage.watchForUser(uid);
  }

  /// Shown in place of the empty state when there are no live announcements
  /// yet, so the dashboard always reads as populated.
  static final Announcement _sampleAnnouncement = Announcement(
    id: 'sample',
    title: '📢 System Maintenance',
    body: 'The portal will undergo brief backend optimizations tonight '
        'from 12:00 AM to 2:00 AM. Please save your active work.',
    postedAt: DateTime.now(),
    author: 'HOA Admin',
    pinned: true,
    // One of the categories the dashboard actually publishes. A placeholder
    // filed under a label no real post can carry is a placeholder that
    // disappears the moment someone taps a filter.
    category: 'Maintenance',
  );

  /// Watches `residents/{uid}.verificationStatus` instead of reading it once.
  ///
  /// This badge previously used [AccountApprovalService.getStatus], a single
  /// `get()` fired in [initState] — so when an admin approved the account on
  /// the web dashboard, the resident kept seeing "Unverified" until they
  /// killed and relaunched the app. The verification gate already listened
  /// (see account_verification_gate.dart), which made the mismatch worse:
  /// the app would unlock while the header still said Unverified.
  Stream<String> _watchApprovalStatus() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return Stream.value(ResidentStatus.pending);
    return AccountApprovalService.statusStream(uid);
  }

  /// The name to greet, from whichever source has one.
  ///
  /// Derived on every build from the LIVE profile rather than resolved once
  /// into a future — see [_propertyStream]. The fallback chain is unchanged:
  /// the profile document, then the Firebase display name, then the local part
  /// of the email, then a generic address of last resort.
  ({String first, String full}) _nameFrom(UserProfile? profile) {
    final user = FirebaseAuth.instance.currentUser;
    final full = (profile?.name.trim().isNotEmpty ?? false)
        ? profile!.name.trim()
        : ((user?.displayName?.trim().isNotEmpty ?? false)
            ? user!.displayName!.trim()
            : (user?.email?.split('@').first ?? 'Resident'));
    return (first: full.split(' ').first, full: full);
  }

  /// The address line, or an empty string while the first snapshot is in
  /// flight.
  ///
  /// Empty, NOT the verification prompt. Defaulting to "Complete property
  /// verification" would accuse a fully verified resident of an incomplete
  /// account on every cold start, for as long as the read takes — the same
  /// mistake the status pill avoids by rendering nothing until it knows.
  String _addressFrom(AsyncSnapshot<PropertyRecord?> snap) {
    if (!snap.hasData && snap.connectionState != ConnectionState.done) {
      return '';
    }
    final prop = snap.data;
    if (prop == null) return 'Complete property verification';
    // Comma-separated, not bullet-separated. "Phase 1 • Block 4 • Lot 12"
    // reads as three tags; "Phase 1, Block 4, Lot 12" reads as one address,
    // which is what it is — and it is how a resident says it out loud and how
    // the dispatcher's console prints it.
    return 'Phase ${prop.phase}, Block ${prop.block}, Lot ${prop.lot}';
  }

  // The time-of-day greeting that lived here is gone with the header redesign
  // — see [_HeaderIdentity] for why.

  @override
  Widget build(BuildContext context) {
    // ── THE MAP RUNS THE FULL HEIGHT, UNDER THE HEADER ──────────────────────
    //
    // Previously this was `Column[header, Expanded[Stack[map, sheet]]]`, so the
    // map began BELOW the header and the header's rounded bottom corners had
    // nothing behind them but the scaffold — two white notches, plus a
    // full-width white band for the moment before the first tiles painted.
    //
    // Now the map is a full-bleed layer and the header floats on top of it, so
    // what shows through those corners is imagery. Nothing about the sheet's
    // geometry changes: it still lives inside an Expanded BELOW the header, so
    // `maxChildSize: 1.0` still means "up to the header's bottom edge" and it
    // can never ride over the greeting or the bell.
    //
    // The collapse hazard the old comment describes is unchanged too — the map
    // is still handed an explicit height from a LayoutBuilder that reads the
    // constraint its parent already guarantees, so the dependency cannot invert.
    // Re-measured after every frame, guarded so an unchanged height costs a
    // comparison and nothing else. See [_measureHeader].
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _measureHeader());

    return LayoutBuilder(
      builder: (context, bodyConstraints) {
        return Stack(
          children: [
            Positioned.fill(
              child: HomepageMapboxCard(
                height: bodyConstraints.maxHeight,
                // Backdrop, not a card: no frame, no radius, and — since this
                // is the unboxed path — no ClipRRect around the platform view.
                // See BoundedMapWidget for why that matters to gesture latency.
                boxed: false,
                // Push the map's floating overlay clear of the header sitting
                // on top of it, so the layer toggle and the recentre button
                // land on imagery instead of behind an opaque green bar.
                overlayInset: EdgeInsets.only(top: _headerHeight),
                // "Centre on me" centres in the strip between the header and
                // the announcements sheet at its resting size (0.46 of the
                // body below the header), not behind either of them.
                cameraPadding: EdgeInsets.only(
                  top: _headerHeight,
                  bottom: math.max(
                      0, (bodyConstraints.maxHeight - _headerHeight) * 0.46),
                ),
              ),
            ),
            _buildBody(context),
          ],
        );
      },
    );
  }

  Widget _buildBody(BuildContext context) {
    return Column(
      children: [
        // Modern, responsive header. Keyed so its height can be measured and
        // handed to the map underneath it — see [_measureHeader].
        KeyedSubtree(key: _headerKey, child: _buildHeader(context)),
        // Dashboard body: the map fills it, the announcements sheet floats
        // over it and drags up to meet the header above.
        //
        // THE COLLAPSE THIS AVOIDS. An earlier revision of this screen was the
        // same shape and had to be torn out, because the Stack sized itself
        // around the map: when the map subtree mis-took its constraints, every
        // sibling measured against that Stack collapsed with it. Here the
        // dependency runs the other way and cannot invert:
        //
        //   * LayoutBuilder reads the height the parent Expanded already
        //     guarantees, so the Stack's size is settled BEFORE the map is
        //     built and cannot be influenced by it.
        //   * The map is handed that height explicitly, through
        //     BoundedMapWidget, which pins it with a tight SizedBox and wraps
        //     the subtree in an error boundary.
        //   * The sheet's extents are fractions of the same settled
        //     constraint, never of the map.
        //
        // So the worst case is a labelled placeholder where the map should be,
        // with the announcements sheet still fully usable on top of it.
        Expanded(
          child: ListenableBuilder(
            listenable: LocalDataStore.instance,
            builder: (context, _) {
              final live = LocalDataStore.instance.announcements;
              // Always show something real-looking rather than an empty state.
              // PINNED FIRST, then newest — see sortAnnouncementsForFeed. The
              // store orders by `publishedAt DESC` only, so without this a
              // pinned notice sank as soon as three ordinary ones were posted
              // after it, which is the opposite of what pinning is for.
              final display = live.isEmpty
                  ? [_sampleAnnouncement]
                  : sortAnnouncementsForFeed(live).take(10).toList();
              final hPad =
                  MediaQuery.of(context).size.width >= 600 ? 28.0 : 20.0;

              // The map is no longer a child here — it is the full-height layer
              // behind this whole column. This Stack exists only to host the
              // sheet, which positions itself within it.
              return Stack(
                children: [
                  DraggableScrollableSheet(
                    // Opens showing roughly half the map — enough map to
                    // orient by, enough sheet to read two notices without
                    // dragging.
                    initialChildSize: 0.46,
                    minChildSize: 0.28,
                    // 1.0 is the whole body, whose top edge IS the bottom
                    // of the header. That is what "extends up to the
                    // header nav bar" resolves to: the sheet stops flush
                    // against it and can never ride over the greeting or
                    // the notification bell.
                    maxChildSize: 1.0,
                    snap: true,
                    snapSizes: const [0.28, 0.46, 1.0],
                    builder: (context, scrollController) {
                      return AnnouncementsPanel(
                        items: display,
                        loading: !LocalDataStore.instance.hasLoadedAnnouncements,
                        scrollController: scrollController,
                        onSeeAll: () =>
                            Navigator.of(context).pushNamed('/announcements'),
                        horizontalPadding: hPad,
                      );
                    },
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  /// The header's ONE action: notifications.
  ///
  /// The Settings gear that sat beside this is gone. Settings is tab 3 of the
  /// bottom nav, permanently on screen — a second entry point in the header
  /// bought nothing and cost the header's only uncluttered corner.
  ///
  /// `w-10 h-10 rounded-full bg-white/15 text-white`, inside a 44px target.
  Widget _headerAction({
    required IconData icon,
    required String semanticLabel,
    required VoidCallback onTap,
    bool badge = false,
  }) {
    return _PressableHeaderAction(
      icon: icon,
      semanticLabel: semanticLabel,
      onTap: onTap,
      badge: badge,
    );
  }

  /// Header: unboxed, resting directly on the shell.
  ///
  /// The greeting used to live inside a bordered glass card — a box drawn
  /// around content that was already the top of the screen, which on a light
  /// surface reads as a panel floating for no reason. Modern mobile headers
  /// let the type sit on the backdrop and use weight, colour and spacing for
  /// hierarchy instead of a frame. The only boxed things left up here are the
  /// two action buttons, where the surface is what makes them tappable.
  /// The dashboard header: avatar · name + verification · notification bell.
  ///
  /// `rounded-[5px] bg-white border border-slate-100 shadow-sm p-4`, with
  /// `flex items-center justify-between` inside it.
  ///
  /// ── A CARD, NOT A BAR ─────────────────────────────────────────────────────
  /// This was a full-bleed strip with a hairline under it. The hairline existed
  /// because the canvas went pure white and header and body became the same
  /// surface with no seam. A bordered card solves that more completely: it is
  /// separated on all four sides rather than only underneath, and it matches
  /// how every other block on this dashboard is framed.
  ///
  /// The 5px radius needs the horizontal margin below to be visible at all — a
  /// rounded corner flush against the screen edge has nothing to round against.
  Widget _buildHeader(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final isWide = width >= 600;
    // `text-lg`, one step up on a tablet.
    final nameSize = isWide ? 21.0 : 19.0;
    // `px-5`, opened up on a tablet where the header spans much further.
    final hPad = isWide ? 24.0 : 20.0;

    return DecoratedBox(
      // The green paints from the very top of the screen — OUTSIDE the
      // SafeArea, so it fills behind the status bar rather than leaving a
      // white strip above itself. The SafeArea inside only insets the
      // CONTENT. Putting the colour inside instead is the standard way this
      // goes wrong.
      decoration: const BoxDecoration(
        color: AppColors.headerSurface,
        borderRadius: BorderRadius.vertical(
          // `rounded-b-2xl`, at the app's unified card radius so the header's
          // bottom edge agrees with every panel beneath it. Top corners stay
          // square: the header is flush to the device edge, and a rounded
          // corner there has nothing to round against.
          bottom: Radius.circular(AppCard.radius),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Padding(
              // `px-5 py-4`.
              padding: EdgeInsets.fromLTRB(hPad, 16, hPad, 16),
              // ── AVATAR · IDENTITY · BELL ──────────────────────────────
              //
              // Three slots on one centre line, and each is driven by its own
              // live source rather than by a single future resolved at mount:
              // the profile document for the picture and the name, the
              // property document for the address, the residents document for
              // the status pill. A correction made on the admin portal lands
              // here on the next frame.
              child: ListenableBuilder(
                listenable: UserProfileService.instance,
                builder: (context, _) {
                  final profile = UserProfileService.instance.profile;
                  final resident = _nameFrom(profile);
                  return StreamBuilder<PropertyRecord?>(
                    stream: _propertyStream,
                    builder: (context, snapshot) {
                  return Row(
                    // `items-center` — the avatar, the bell's 44px box and the
                    // text stack share a centre line whatever the stack's
                    // height.
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      _HeaderAvatar(
                        name: resident.full,
                        photoUrl: profile?.photoUrl ?? '',
                      ),
                      const SizedBox(width: 12),
                      // `justify-between` is expressed as Expanded + a fixed
                      // trailing box rather than spaceBetween, because the text
                      // must be allowed to TRUNCATE against the bell rather
                      // than push it off the edge.
                      Expanded(
                        child: _HeaderIdentity(
                          name: resident.first,
                          address: _addressFrom(snapshot),
                          nameSize: nameSize,
                          approvalStream: _approvalStream,
                        ),
                      ),
                      const SizedBox(width: 12),
                      // The bell's dot reflects reality. It was `badge: true` —
                      // permanently lit — so it asserted "you have unread
                      // updates" to every resident on every load, including
                      // ones who had never filed a report. A dot that is always
                      // on carries no information and trains people to stop
                      // looking at it.
                      //
                      // PRESENCE, NOT UNREAD. There is no read cursor yet, so
                      // this lights when the resident has ANY updates rather
                      // than any they have not seen. That is the honest claim
                      // the available data supports, and the Semantics label
                      // says "updates" rather than "unread" to match. A real
                      // cursor (last-seen stamp compared against the newest
                      // event's `at`) is the follow-up.
                      ListenableBuilder(
                        listenable: LocalDataStore.instance,
                        builder: (context, _) {
                          final store = LocalDataStore.instance;
                          final updates = ResidentNotification.build(
                            incidents: store.incidents,
                            announcements: store.announcements,
                          );
                          return _headerAction(
                            icon: PhosphorIconsFill.bell,
                            semanticLabel: updates.isEmpty
                                ? 'Notifications'
                                : 'Notifications, ${updates.length} '
                                    '${updates.length == 1 ? 'update' : 'updates'}',
                            onTap: () => Navigator.of(context)
                                .pushNamed('/notifications'),
                            badge: updates.isNotEmpty,
                          );
                        },
                      ),
                    ],
                  );
                    },
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// Pill ink, one step darker than the semantic tokens they correspond to.
//
// The pill sets at 12px semibold on a solid white fill, so its label needs the
// full 4.5:1. The app's own accents do not clear that on white at this size —
// AppColors.success (#16A34A) is 3.30:1 and AppColors.warning (#F59E0B) is
// 2.15:1 — so each drops one step. Same family, same meaning, legible.
const Color _pillVerifiedInk = Color(0xFF166534); // green-800, 7.1:1
const Color _pillPendingInk = Color(0xFF92400E); // amber-800, 6.7:1
const Color _pillRejectedInk = Color(0xFF9F1239); // rose-800, 7.4:1

/// The `Verified` / `Unverified` badge, inline with the address.
///
/// ── WHY IT IS A SOLID WHITE PILL, NOT `bg-white/20` ───────────────────────
/// The spec asks for a glass chip — `bg-white/20 text-white border-white/30`.
/// That cannot be made legible on this header, and not for want of tuning:
/// white text on white-at-20%-over-green composites to 3.49:1, and pushing the
/// fill to 30% makes it WORSE (2.94:1), because every step of opacity moves the
/// background toward the text colour. A translucent-white pill and white text
/// are fighting for the same end of the scale.
///
/// A solid white fill with the status colour as ink inverts the problem and
/// lands at 7:1. It also delivers what the spec actually asked for in words —
/// "crisp, compact", "high-contrast pill badge" — which the glass version did
/// not. Geometry, padding, border and the icon+label pairing are unchanged.
///
/// If the glass look is wanted regardless, it is a two-line change here; it
/// just should not ship as an accessibility claim.
class _VerifiedPill extends StatelessWidget {
  const _VerifiedPill({
    required this.label,
    required this.icon,
    required this.ink,
  });

  final String label;
  final IconData icon;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    return Container(
      // `px-2.5 py-0.5`
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        // `border border-white/30` reads as nothing against a white fill, so
        // the hairline is a faint tint of the ink instead — it defines the
        // pill's edge where it meets the green.
        border: Border.all(color: ink.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // `gap-1`
          Icon(icon, size: 11, color: ink),
          const SizedBox(width: 4),
          Text(
            label,
            style: sfPro(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: ink,
              letterSpacing: 0.1,
              height: 1.1,
            ),
          ),
        ],
      ),
    );
  }
}

/// The bell, on the green header.
///
/// A 40px translucent-white disc inside a 44px hit box. Both numbers are
/// load-bearing and they disagree with each other on purpose: the spec asks
/// for `w-10 h-10` (40px) AND a 44px minimum touch target, which is only
/// satisfiable by making the VISIBLE circle 40 and the TAPPABLE box 44. Same
/// trick ModernBackButton and ModernCloseButton use.
///
/// `active:scale-95` is a real press state rather than a ripple: an InkWell
/// splash inside a translucent disc on a saturated ground reads as a smear,
/// and the disc is small enough that scaling the whole thing is legible.
class _PressableHeaderAction extends StatefulWidget {
  const _PressableHeaderAction({
    required this.icon,
    required this.semanticLabel,
    required this.onTap,
    this.badge = false,
  });

  final IconData icon;
  final String semanticLabel;
  final VoidCallback onTap;
  final bool badge;

  @override
  State<_PressableHeaderAction> createState() => _PressableHeaderActionState();
}

class _PressableHeaderActionState extends State<_PressableHeaderAction> {
  bool _pressed = false;

  void _set(bool v) {
    if (_pressed == v) return;
    setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.badge
          ? '${widget.semanticLabel}, unread'
          : widget.semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _set(true),
        onTapUp: (_) => _set(false),
        onTapCancel: () => _set(false),
        onTap: () {
          HapticFeedback.selectionClick();
          widget.onTap();
        },
        child: AnimatedScale(
          scale: _pressed ? 0.95 : 1,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOut,
          child: SizedBox(
            width: 44,
            height: 44,
            child: Stack(
              alignment: Alignment.center,
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    // `bg-white/15`. The white glyph on it measures 3.8:1
                    // against the composited fill — over the 3:1 floor WCAG
                    // 1.4.11 sets for a graphic.
                    color: Colors.white.withValues(alpha: 0.15),
                  ),
                  child: Icon(widget.icon, color: Colors.white, size: 20),
                ),
                if (widget.badge)
                  Positioned(
                    // Measured from the 40px disc, which sits inset 2px inside
                    // this 44px box.
                    top: 8,
                    right: 8,
                    child: Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        // AMBER, not the app's emerald and not danger red.
                        //
                        // Emerald was right on the old white header and is
                        // invisible on this one — a green dot on green. Red
                        // stays reserved: in this app it means the SOS button,
                        // a critical incident, loss of coverage, and spending
                        // it on "you have an unread update" devalues it where
                        // it has to keep meaning something.
                        color: AppColors.warning,
                        // Ringed in the header's own green so the dot separates
                        // from the bell glyph it overlaps.
                        border: Border.all(
                          color: AppColors.headerSurface,
                          width: 2,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}


/// The resident's picture in the dashboard header.
///
/// ── WHY THE HEADER HAS ONE AT ALL ─────────────────────────────────────────
/// The greeting was a name and an address with a bell floating opposite it —
/// two text lines and an icon, with nothing anchoring the left edge. A header
/// like that reads as a caption. An avatar gives the row a subject: the block
/// becomes "this is you, here is where you live, here is your status", which is
/// what a resident dashboard is supposed to say in one glance.
///
/// ── INITIALS ARE THE DEFAULT, NOT THE FALLBACK ────────────────────────────
/// Most residents never set a photo. So the initials treatment is designed
/// first — a white-on-translucent monogram that sits deliberately on the green
/// — and the photograph is what replaces it when there is one. A generic person
/// glyph would have made every unset account look identically anonymous.
class _HeaderAvatar extends StatelessWidget {
  const _HeaderAvatar({required this.name, required this.photoUrl});

  final String name;
  final String photoUrl;

  /// Big enough to read a two-letter monogram at, small enough that the
  /// greeting beside it still leads the row. Fixed rather than a parameter —
  /// this header is the only place an avatar this size appears, and a knob
  /// with one setting is a knob nobody can turn correctly.
  static const double size = 46;

  /// One letter, or two for a name with a surname. Derived rather than stored,
  /// so it follows a name corrected by the office without a second write.
  static String initialsOf(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.first.toUpperCase();
    return (parts.first.characters.first + parts.last.characters.first)
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Your profile picture',
      image: true,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          // A translucent white wash, not a solid tile: on the green header a
          // white disc would out-weigh the resident's own name beside it.
          color: Colors.white.withValues(alpha: 0.18),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.55),
            width: 1.5,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: photoUrl.isEmpty
            ? _initials()
            : CachedNetworkImage(
                imageUrl: photoUrl,
                fit: BoxFit.cover,
                // Decoded at roughly the size it is drawn — a 46px circle has
                // no use for a 2000px portrait, and this header is built on
                // every dashboard frame.
                memCacheWidth: 160,
                fadeInDuration: const Duration(milliseconds: 220),
                // The monogram holds the space while the photo loads and
                // stands in permanently if it never does. No spinner: a
                // 46px circle is too small to spin in, and the initials are
                // already the right answer.
                placeholder: (_, __) => _initials(),
                errorWidget: (_, __, ___) => _initials(),
              ),
      ),
    );
  }

  Widget _initials() => Center(
        child: Text(
          initialsOf(name),
          style: _t(
            size: size * 0.36,
            weight: FontWeight.w700,
            color: Colors.white,
            letterSpacing: 0.2,
            height: 1,
          ),
        ),
      );
}

/// The header's identity block: the resident's name, and whether their account
/// is verified.
///
/// ── NO TIME-OF-DAY GREETING ───────────────────────────────────────────────
/// "Good morning," is gone. It was the first line of the app's most valuable
/// strip of screen and it carried no information — the resident knows what time
/// it is, and it said the same thing to every user for four hours at a stretch.
/// What replaces it is the one fact this header can state that the resident
/// cannot see for themselves: whether the HOA has approved their account.
///
/// ── STATUS AS TEXT, NOT A BADGE ───────────────────────────────────────────
/// This used to be a glass pill clipped to the avatar's lower-right: a
/// checkmark when approved, an amber clock when not. Two problems with the
/// icon form. At ~16px the check and the clock are nearly the same shape at a
/// glance, so the states were distinguished mostly by hue — which is the whole
/// signal gone for a red-green colour-blind resident. And "pending" is an
/// instruction, not an ornament: it means the account still needs action, and
/// a wordless icon in the corner of a photo is the quietest possible way to
/// say so. A word cannot be misread.
class _HeaderIdentity extends StatelessWidget {
  const _HeaderIdentity({
    required this.name,
    required this.address,
    required this.nameSize,
    required this.approvalStream,
  });

  final String name;

  /// "Phase 1, Block 4, Lot 12", or a prompt to finish verification.
  final String address;

  final double nameSize;
  final Stream<String> approvalStream;

  @override
  Widget build(BuildContext context) {
    // ── TWO LINES ────────────────────────────────────────────────────────
    //
    //   Lian  [✓ Verified]      the name, display weight, status beside it
    //   ⌖ Phase 2, Block 5, Lot 02   the address, given its own full line
    //
    // No greeting above the name (removed 2026-10-18 at the user's request):
    // the avatar and the name already say whose dashboard this is.
    //
    // The address used to share a row with the status pill and was the part
    // that gave way, so every resident saw "Phase 2, Block 5, Lot…". The pill
    // now rides on the name's line, which is short, and the address gets the
    // whole width.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Flexible(
              child: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _t(
                  size: nameSize + 1,
                  weight: FontWeight.w800,
                  letterSpacing: -0.5,
                  height: 1.15,
                  color: Colors.white,
                ),
              ),
            ),
            const SizedBox(width: 8),
            StreamBuilder<String>(
              stream: approvalStream,
              builder: (context, snap) {
                // Until the first value arrives, render nothing rather than
                // guess. Defaulting to "Unverified" would flash a false
                // accusation at every verified resident on every cold start.
                if (!snap.hasData) return const SizedBox.shrink();

                final status = snap.data;
                final verified = status == ResidentStatus.verified;
                final rejected = status == ResidentStatus.rejected;
                // Pending and rejected both read "Unverified", with colour
                // carrying the difference — see the note this replaced.
                return _VerifiedPill(
                  label: verified ? 'Verified' : 'Unverified',
                  icon: verified
                      ? PhosphorIconsFill.sealCheck
                      : PhosphorIconsFill.clock,
                  ink: verified
                      ? _pillVerifiedInk
                      : (rejected ? _pillRejectedInk : _pillPendingInk),
                );
              },
            ),
          ],
        ),
        if (address.isNotEmpty) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(PhosphorIconsBold.mapPin,
                  size: 13, color: Colors.white.withValues(alpha: 0.85)),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  address,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: _t(
                    size: 13.5,
                    weight: FontWeight.w500,
                    // White at 88%: subordinate to the name, still the most
                    // legible the emerald surface allows.
                    color: Colors.white.withValues(alpha: 0.88),
                    letterSpacing: -0.05,
                    height: 1.25,
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

// `_GlassBadge`, the 19px frosted check/clock pill that used to hang off the
// avatar's corner, is deleted. Its job — saying whether the account is
// approved — is now done in words by [_HeaderIdentity].

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATES TAB
// ═══════════════════════════════════════════════════════════════════════════════

class _SettingsTab extends StatefulWidget {
  const _SettingsTab();

  @override
  State<_SettingsTab> createState() => _SettingsTabState();
}

/// ─────────────────────── SETTINGS ───────────────────────
/// The Settings tab: the screen the bottom nav actually opens.
///
/// ── ONE CONTAINER, AND IT IS THE HISTORY CARD ─────────────────────────────
/// Every panel here used to be `AppColors.glassFill` (white at 70%) inside
/// `Border.all(AppColors.glassBorderLight)` — an emerald-100 hairline. That was
/// the green outline around every settings group, and it is a survival from the
/// shell's glass era, when these cards floated over a dark gradient and needed a
/// lit edge to separate from it. The shell is white now: a translucent fill has
/// nothing left to be translucent against, and the emerald edge is a green box
/// ruled around grey text.
///
/// Groups are [AppCard]s — solid white, no stroke, [AppShadows.sm],
/// [AppRadius.lg]. That is not "the same numbers as a History card"; it is the
/// same widget the History feed builds its cards from, so the two screens
/// cannot drift apart again.
///
/// ── AND THE ROWS ARE THE SHARED ROWS ──────────────────────────────────────
/// The rows were a private `_SettingsItem`/`_SettingsGroup` pair defined in
/// this file: 36px tiles, w500 labels at 15, a different tint per row, and
/// dividers indented by a hand-typed 60 against a real content offset of 66.
/// The app already has [SettingsRow] — 40px tiles, w600 at 14.5, one accent
/// colour, and a divider inset DERIVED from the row's own grid. Two
/// implementations of "a settings row" is how this app came to have two
/// settings screens that look nothing like each other. There is one row now,
/// and both screens use it.
///
/// ── THE SECTIONS ──────────────────────────────────────────────────────────
/// Four, each answering one question a resident arrives with: who am I here
/// (Account preferences), how do I secure and hear from this app (Security &
/// notifications), who do I call (HOA contacts), what IS this app (App info).
/// The old grouping split Change Password from Property Details for no reason
/// either row could explain, and left Terms and Privacy under a heading —
/// "TERMS & POLICY" — that only restated the two rows beneath it.
class _SettingsTabState extends State<_SettingsTab>
    with WidgetsBindingObserver {
  /// Live for the same reason as the home header's badge — an admin approval
  /// must reach this pill without an app restart. See
  /// `_HomeTabState._watchApprovalStatus`.
  late Stream<String> _approvalStream;

  /// Whether the OS lets the app notify. Null until first read; re-read on
  /// resume, because the place a resident fixes a block is system Settings.
  bool? _osAllowsPush;

  /// True while the OS dialog is up, so a second tap cannot stack another.
  bool _pushBusy = false;

  /// Where the switch was just moved to, shown until the answer is known, so
  /// it follows the thumb at once instead of waiting on the OS dialog and a
  /// Firestore write. Cleared — and reverted if refused — once settled.
  bool? _pushOptimistic;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final uid = FirebaseAuth.instance.currentUser?.uid;
    _approvalStream = uid != null
        ? AccountApprovalService.statusStream(uid)
        : Stream.value(ResidentStatus.pending);
    _readOsPush();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_pushBusy) _readOsPush();
  }

  /// Set when ON was refused and the resident was sent to system Settings.
  /// Coming back with notifications now allowed finishes the job the switch
  /// started — token written, preference saved — instead of leaving the
  /// switch off and making them flip it a second time.
  bool _enableOnReturn = false;

  Future<void> _readOsPush() async {
    final allowed = await PushRegistration.instance.isAllowedByOs();
    if (!mounted) return;
    if (allowed != _osAllowsPush) {
      setState(() => _osAllowsPush = allowed);
    }
    if (_enableOnReturn) {
      _enableOnReturn = false;
      if (allowed) await _setPush(true);
    }
  }

  /// The Push notifications switch.
  ///
  /// ON goes straight to the native OS permission dialog — the switch is the
  /// consent moment, so nothing stands in front of it. If the OS says no (now,
  /// or from an earlier answer it remembers), the switch stays off and a
  /// snackbar offers the system Settings page, the only place that answer
  /// can be changed. OFF removes this device's token so the server stops
  /// sending; the OS permission is left for next time.
  Future<void> _setPush(bool on) async {
    if (_pushBusy) return;
    _pushBusy = true;
    setState(() => _pushOptimistic = on);
    try {
      if (on) {
        final result = await PushRegistration.instance.enable();
        if (!mounted) return;
        setState(() => _osAllowsPush = result == PushPermission.granted);
        // ── A REVOKED PERMISSION ──────────────────────────────────────────
        // `enable()` already asked the OS. Denied here means the OS held an
        // earlier "no" and showed nothing — both platforms stop prompting
        // after a refusal — so the switch takes the resident straight to
        // this app's notification settings, the one native control left.
        // The snackbar below stays as the explanation (and the way back if
        // the page could not be opened).
        if (result == PushPermission.denied) {
          _enableOnReturn = true;
          final opened = await PushRegistration.instance.openSystemSettings();
          if (!opened) await Geolocator.openAppSettings();
          if (!mounted) return;
        }
        if (result != PushPermission.granted) {
          final messenger = ScaffoldMessenger.of(context);
          messenger
            ..hideCurrentSnackBar()
            ..showSnackBar(
              SnackBar(
                content: Text(
                  result == PushPermission.denied
                      ? 'Notifications are blocked for this app.'
                      : 'Notifications are not available on this device.',
                  style: _t(size: 13),
                ),
                behavior: SnackBarBehavior.floating,
                backgroundColor: AppColors.backgroundElevated,
                margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                action: result == PushPermission.denied
                    ? SnackBarAction(
                        label: 'Settings',
                        textColor: AppColors.accentPrimary,
                        onPressed: () async {
                          _enableOnReturn = true;
                          if (!await PushRegistration.instance
                              .openSystemSettings()) {
                            await Geolocator.openAppSettings();
                          }
                        },
                      )
                    : null,
              ),
            );
          return;
        }
      } else {
        await PushRegistration.instance.disable();
      }
      // The OS permission and the token are already settled above; a failed
      // preference write only means the stored flag lags until the next
      // toggle, which [_readOsPush] reconciles on the next refresh.
      try {
        await UserProfileService.instance
            .updateField(notificationsEnabled: on);
      } catch (_) {}
    } finally {
      _pushBusy = false;
      if (mounted) setState(() => _pushOptimistic = null);
    }
  }

  bool _signingOut = false;

  /// Asks first, then ends the session. The flag stops a second tap — on the
  /// row, or on Log Out while the token revoke is in flight — from running
  /// sign-out twice.
  Future<void> _signOut() async {
    if (_signingOut) return;
    if (!await confirmSignOut(context)) return;
    _signingOut = true;
    try {
      await endResidentSession();
    } finally {
      _signingOut = false;
    }
    if (mounted) {
      Navigator.of(context).popUntil((route) => route.isFirst);
    }
  }

  void _openLegal(LegalDocument document) {
    Navigator.of(context).push(
      MaterialPageRoute(
          builder: (_) => LegalDocumentScreen(document: document)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: ListenableBuilder(
        listenable: UserProfileService.instance,
        builder: (context, _) {
          final service = UserProfileService.instance;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // OUTSIDE the swap. The title is not waiting on anything, and a
              // heading that blanks out while the profile loads reads as the
              // screen having failed to open rather than as it filling in.
              Padding(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.screenGutter, 18, AppSpacing.screenGutter, 22),
                child: Text(
                  'Settings',
                  // Centred in the bar. The other tabs are content screens
                  // whose headings start where their content starts;
                  // Settings is a destination, and a destination's name
                  // belongs on the axis of the screen it names.
                  textAlign: TextAlign.center,
                  style: _t(
                      size: 28, weight: FontWeight.w700, letterSpacing: -0.5),
                ),
              ),
              Expanded(
                child: service.hasLoaded
                    ? _body(context, service.profile)
                    : const SettingsSkeleton(),
              ),
            ],
          );
        },
      ),
    );
  }

  /// Pull to refresh: the profile document and the OS notification switch,
  /// the two things on this screen that can change elsewhere.
  Future<void> _refresh() async {
    await Future.wait([
      UserProfileService.instance.load(),
      _readOsPush(),
    ]);
  }

  Widget _body(BuildContext context, UserProfile? profile) {
    // The app's one pull-to-refresh, as on every other scrolling page.
    return RefreshShell(
      onRefresh: _refresh,
      child: _list(context, profile),
    );
  }

  Widget _list(BuildContext context, UserProfile? profile) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenGutter,
        0,
        AppSpacing.screenGutter,
        AppSpacing.navClearance,
      ),
      children: [
        _ProfileCard(profile: profile, approval: _approvalStream),
        const SizedBox(height: 24),

        const _SectionLabel(label: 'ACCOUNT PREFERENCES'),
        _SettingsCard(
          rows: [
            SettingsRow(
              icon: AppIcons.profile,
              label: 'Edit profile',
              onTap: () => Navigator.of(context).pushNamed('/edit-profile'),
            ),
            SettingsRow(
              icon: AppIcons.property,
              label: 'Property details',
              onTap: () => Navigator.of(context).pushNamed('/property-details'),
            ),
          ],
        ),
        const SizedBox(height: 24),

        const _SectionLabel(label: 'SECURITY & NOTIFICATIONS'),
        _SettingsCard(
          rows: [
            SettingsRow(
              icon: AppIcons.password,
              label: 'Change password',
              onTap: () => Navigator.of(context).pushNamed('/change-password'),
            ),
            SettingsSwitchRow(
              icon: AppIcons.pushNotifications,
              label: 'Push notifications',
              // On only when BOTH the resident wants it and the OS allows it.
              // A switch reading "on" while the OS blocks every notification
              // is a promise the phone is not keeping.
              value: _pushOptimistic ??
                  ((profile?.notificationsEnabled ?? true) &&
                      (_osAllowsPush ?? true)),
              onChanged: _setPush,
            ),
          ],
        ),
        const SizedBox(height: 24),

        const _SectionLabel(label: 'HOA CONTACTS'),
        const _HoaContactsCard(),
        const SizedBox(height: 24),

        const _SectionLabel(label: 'APP INFO'),
        _SettingsCard(
          rows: [
            SettingsRow(
              icon: AppIcons.terms,
              label: 'Terms and Conditions',
              onTap: () => _openLegal(termsAndConditions),
            ),
            SettingsRow(
              icon: AppIcons.privacy,
              label: 'Privacy Policy',
              onTap: () => _openLegal(privacyPolicy),
            ),
            SettingsRow(
              icon: AppIcons.about,
              label: 'App version',
              showChevron: false,
              // A statement, not a destination: the row has no tap handler, so
              // it does not report itself as a button either.
              trailing: Text(
                'v1.0.0',
                style: _t(size: 13, color: AppColors.textMuted),
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),

        _SettingsCard(
          rows: [
            SettingsRow(
              icon: AppIcons.signOut,
              label: 'Sign out',
              destructive: true,
              showChevron: false,
              onTap: _signOut,
            ),
          ],
        ),
        const SizedBox(height: 20),
        Center(
          child: Text(
            'Monticello Villas  ·  v1.0.0',
            style: _t(size: 11.5, color: AppColors.textMuted),
          ),
        ),
      ],
    );
  }
}

/// The heading above a group. One definition, so four sections cannot set at
/// four sizes.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Indented to the card's own corner radius rather than to its edge, and
      // 10 above the panel it names — close enough to belong to it, clear of
      // the 24 that separates one section from the next.
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
      child: Text(
        label,
        style: _t(
          size: 11.5,
          weight: FontWeight.w600,
          color: AppColors.textMuted,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

/// A group of settings rows on one borderless white panel.
///
/// The dividers are inserted here rather than by the caller: a row does not
/// know whether it is the last one, and every list that made its callers pass
/// separators eventually grew one with a trailing divider against the panel's
/// bottom edge.
class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.rows});

  final List<Widget> rows;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      // The History card, exactly: white, no stroke, contact shadow, lg corner.
      showBorder: false,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      // The rows own their padding — see SettingsRow.padX/padY — so the panel
      // contributes only the frame.
      padding: EdgeInsets.zero,
      // Each row paints an InkWell ripple to the panel's edge; without clipping
      // the first and last splashes square off the corners.
      clipContents: true,
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const SettingsRowDivider(),
            rows[i],
          ],
        ],
      ),
    );
  }
}

/// Name, email and verification standing, on the same panel as everything else.
class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.profile, required this.approval});

  final UserProfile? profile;
  final Stream<String> approval;

  @override
  Widget build(BuildContext context) {
    final name = profile?.name.trim().isNotEmpty == true
        ? profile!.name.trim()
        : 'Resident';
    final email = profile?.email ?? '';
    final photo = profile?.photoUrl ?? '';
    final initials = name.substring(0, 1).toUpperCase();

    return AppCard(
      showBorder: false,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      padding: const EdgeInsets.all(18),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              // Emerald wash at 12%, the same tile recipe as the rows below —
              // and NO ring. The white-at-30% border this carried was drawn for
              // a dark glass card; on a white panel it is a white line on
              // white, which is either invisible or, once the panel went solid,
              // a faint scratch across the avatar's edge.
              color: AppColors.primary
                  .withValues(alpha: SettingsIconTile.washOpacity),
              image: photo.isNotEmpty
                  ? DecorationImage(
                      image: NetworkImage(photo), fit: BoxFit.cover)
                  : null,
            ),
            child: photo.isNotEmpty
                ? null
                : Center(
                    child: Text(
                      initials,
                      style: _t(
                          size: 22,
                          weight: FontWeight.w700,
                          color: AppColors.primary),
                    ),
                  ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: _t(size: 16, weight: FontWeight.w700)),
                if (email.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(email,
                      style: _t(size: 13, color: AppColors.textSecondary)),
                ],
                const SizedBox(height: 8),
                StreamBuilder<String>(
                  stream: approval,
                  builder: (context, snap) => _VerificationPill(
                    status: snap.data ?? ResidentStatus.pending,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Verified / pending, as a filled pill.
///
/// Fill only. The 45%-alpha ring this used to carry was a second, fainter
/// statement of the colour already filling the badge — and on the screen whose
/// brief was "remove the green outlines", a green outline.
class _VerificationPill extends StatelessWidget {
  const _VerificationPill({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final approved = status == ResidentStatus.verified;
    final tone = approved ? AppColors.success : AppColors.warning;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            approved ? PhosphorIconsFill.sealCheck : PhosphorIconsFill.clock,
            size: 14,
            color: tone,
          ),
          const SizedBox(width: 5),
          Text(
            approved ? 'Verified' : 'Pending verification',
            style: _t(size: 11, weight: FontWeight.w700, color: tone),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOA CONTACTS
// ═══════════════════════════════════════════════════════════════════════════════

/// A single directory entry: display name, role, and contact number.
class _HoaOfficer {
  final String name;
  final String role;
  final String phone;
  const _HoaOfficer(this.name, this.role, this.phone);
}

/// The directory, read from [HoaContact] — the same constants the contact
/// sheet and the SOS screen dial, so a number changed there changes here.
///
/// It was five invented officers on `+63 917 555 01xx` numbers that reached
/// nobody, on the list a resident opens to call for help.
final List<_HoaOfficer> _hoaOfficers = [
  const _HoaOfficer(
      HoaContact.officeName, 'Office', HoaContact.officeNumber),
  for (final guard in HoaContact.guards)
    _HoaOfficer(guard.name, 'Security guard', guard.number),
];

/// The HOA directory: tap a row to call, long-press to copy the number.
///
/// Built on the same panel and the same row grid as every other group — the
/// leading glyph is [SettingsIconTile] itself, so the directory's column of
/// icons lines up with the column above and below it.
class _HoaContactsCard extends StatelessWidget {
  const _HoaContactsCard();

  Future<void> _call(BuildContext context, String phone) async {
    HapticFeedback.selectionClick();
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      final ok = await launchUrl(HoaContact.dialUri(phone),
          mode: LaunchMode.externalApplication);
      if (!ok) _toast(messenger, 'No phone app to call $phone');
    } catch (_) {
      // No dialler (a tablet, an emulator). The number is on screen to copy.
      _toast(messenger, 'No phone app to call $phone');
    }
  }

  void _copy(BuildContext context, String phone) {
    HapticFeedback.selectionClick();
    Clipboard.setData(ClipboardData(text: phone));
    _toast(ScaffoldMessenger.maybeOf(context), 'Copied $phone');
  }

  static void _toast(ScaffoldMessengerState? messenger, String message) {
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message, style: _t(size: 13)),
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.backgroundElevated,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 20),
          duration: const Duration(seconds: 2),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return AppCard(
      showBorder: false,
      shadows: AppShadows.sm,
      cornerRadius: AppRadius.lg,
      padding: EdgeInsets.zero,
      clipContents: true,
      child: Column(
        children: [
          for (var i = 0; i < _hoaOfficers.length; i++) ...[
            if (i > 0) const SettingsRowDivider(),
            _OfficerRow(
              officer: _hoaOfficers[i],
              onCall: () => _call(context, _hoaOfficers[i].phone),
              onCopy: () => _copy(context, _hoaOfficers[i].phone),
            ),
          ],
        ],
      ),
    );
  }
}

class _OfficerRow extends StatelessWidget {
  const _OfficerRow({
    required this.officer,
    required this.onCall,
    required this.onCopy,
  });

  final _HoaOfficer officer;
  final VoidCallback onCall;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final isOffice = officer.name == HoaContact.officeName;
    return Semantics(
      button: true,
      label: 'Call ${officer.name}, ${officer.role}, ${officer.phone}',
      child: InkWell(
        onTap: onCall,
        onLongPress: onCopy,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: SettingsRow.padX,
            vertical: 10,
          ),
          child: Row(
            children: [
              SettingsIconTile(
                icon: isOffice
                    ? PhosphorIconsBold.buildingApartment
                    : PhosphorIconsBold.shieldCheck,
              ),
              const SizedBox(width: SettingsRow.gap),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      officer.name,
                      style: _t(size: 14.5, weight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${officer.role}  ·  ${officer.phone}',
                      style: _t(size: 12, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // The row's action, said by its glyph: this calls.
              const Icon(PhosphorIconsBold.phoneCall,
                  size: 20, color: AppColors.accentPrimary),
            ],
          ),
        ),
      ),
    );
  }
}
