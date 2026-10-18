import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/firebase/firebase_bootstrap.dart';
import 'package:monticello_villas_app/core/network/connectivity_probe.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/notifications/push_registration.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/gradient_scaffold.dart';
import 'package:monticello_villas_app/features/auth/screens/login_screen.dart';
import 'package:monticello_villas_app/features/home/screens/home_screen.dart';
import 'package:monticello_villas_app/features/onboarding/screens/onboarding_screen.dart';
import 'package:monticello_villas_app/features/onboarding/widgets/splash_view.dart';
import 'package:monticello_villas_app/features/profile/services/user_profile_service.dart';
import 'package:monticello_villas_app/features/property/services/property_storage.dart';


/// The app's single source of truth for "which screen should be on screen".
///
/// It replaces an imperative chain that ran across three files: SplashScreen
/// waited 1.8s then `pushReplacementNamed`'d to one of four routes, LoginScreen
/// separately recomputed the same decision and `pushNamedAndRemoveUntil`'d, and
/// the verification gate sat inside the `/home` route re-deciding again. Three
/// places deriving the same state meant any one of them getting stuck — an
/// await that never returned, a `mounted` check that bailed after a rebuild, a
/// navigation that fired before its prerequisites finished — left the user on
/// whatever screen happened to be mounted, with nothing to retry.
///
/// Here the widget tree is a pure function of auth state. Nothing "navigates"
/// to the home screen; the home screen simply *is* what this builds once a
/// user is signed in and verified. Signing out swaps the tree back with no
/// navigator stack to unwind.
///
/// Named routes are untouched — every existing `Navigator.pushNamed('/report')`
/// keeps working. This governs only the root.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    // A failed Firebase boot is terminal for auth, and `authStateChanges()`
    // would throw rather than emit. Checked before subscribing so this shows a
    // real message instead of an empty stream that never resolves.
    if (!firebaseAppReady) {
      return const _StartupMessage(
        title: 'Setup incomplete',
        message:
            'Firebase could not start. This is a configuration problem with the '
            'app build (google-services.json / firebase_options.dart) rather '
            'than something you can fix from here.',
      );
    }

    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const _StartupLoading();
        }

        final user = snapshot.data;
        if (user == null) return const _SignedOutRouter();

        // Signed in. Everything below depends on per-user state that has to be
        // read once, so it is keyed by uid — switching accounts re-runs it
        // instead of reusing the previous user's answer.
        return _SignedInRouter(key: ValueKey(user.uid), user: user);
      },
    );
  }
}

/// Chooses onboarding vs. login for a signed-out visitor.
class _SignedOutRouter extends StatefulWidget {
  const _SignedOutRouter();

  @override
  State<_SignedOutRouter> createState() => _SignedOutRouterState();
}

class _SignedOutRouterState extends State<_SignedOutRouter> {
  late final Future<bool> _hasSeenOnboarding = OnboardingScreen.hasSeen();

  /// Set the moment onboarding finishes, in memory.
  ///
  /// This must NOT be derived by re-reading the persisted flag.
  /// `OnboardingScreen.markSeen()` swallows every exception, and `hasSeen()`
  /// returns false on error — so if SharedPreferences is unavailable for any
  /// reason, a storage round-trip reports "not seen" forever and the router
  /// rebuilds onboarding on every completion. That is an inescapable loop on
  /// the "Get Started" button, with the failure completely invisible because
  /// both helpers fail silently.
  ///
  /// Persisting the flag is an optimisation for the NEXT launch. Whether it
  /// succeeded must never decide whether this session can move forward.
  bool _onboardingDone = false;

  @override
  Widget build(BuildContext context) {
    if (_onboardingDone) return const LoginScreen();

    return FutureBuilder<bool>(
      future: _hasSeenOnboarding,
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const _StartupLoading();
        }
        if (snapshot.data!) return const LoginScreen();

        return OnboardingScreen(
          onCompleted: () => setState(() => _onboardingDone = true),
        );
      },
    );
  }
}

/// Resolves the per-user prerequisites, then hands off to the account
/// verification gate.
class _SignedInRouter extends StatefulWidget {
  const _SignedInRouter({super.key, required this.user});

  final User user;

  @override
  State<_SignedInRouter> createState() => _SignedInRouterState();
}

class _SignedInRouterState extends State<_SignedInRouter> {
  late Future<void> _sessionReady;

  @override
  void initState() {
    super.initState();
    _sessionReady = _prepareSession();
  }

  /// Hard deadline for every start-up read, with a network path available.
  ///
  /// This is the load-bearing detail. `PropertyStorage.isVerifiedForUser` and
  /// `UserProfileService.load` both end in a Firestore `.get()`, and a `.get()`
  /// with no cached document and no reachable server **does not time out** — it
  /// waits indefinitely. Awaiting one on the path to the dashboard means a
  /// resident on a dead connection sits on "Loading your account" forever, with
  /// no error, no spinner state change, and nothing to tap.
  static const _stepTimeout = Duration(seconds: 8);

  /// The same deadline when the device reports no network interface at all.
  ///
  /// Eight seconds is the right budget for "slow", and the wrong one for
  /// "aeroplane mode" — there, the answer is known before the first byte is
  /// sent, and the only thing the remaining seven and a half seconds buy is
  /// an emblem the resident watches three times over, once per read.
  ///
  /// Not zero, and that is deliberate: Firestore serves from its local cache
  /// through the same `.get()`, so a returning resident genuinely does have
  /// a profile to load offline. This is long enough for a disk read and
  /// nothing like long enough for a network one.
  static const _offlineStepTimeout = Duration(milliseconds: 600);

  /// Resolved once, before the reads, never re-read.
  ///
  /// [ConnectivityProbe.isOnline] cannot be trusted in the affirmative — see
  /// its own doc — so this only ever SHORTENS a deadline. If the probe is
  /// wrong and the device is online after all, the worst case is a cache miss
  /// that the dashboard fills in from its own listeners a moment later, which
  /// is the same thing that happens when a read times out today.
  bool _online = true;

  /// Runs one start-up read with a deadline, never throwing.
  Future<T> _guard<T>(
    String label,
    Future<T> Function() step, {
    required T fallback,
  }) async {
    final deadline = _online ? _stepTimeout : _offlineStepTimeout;
    try {
      return await step().timeout(deadline);
    } on TimeoutException {
      debugPrint('AuthGate: "$label" timed out after $deadline '
          '(online: $_online)');
      return fallback;
    } catch (error) {
      debugPrint('AuthGate: "$label" failed: $error');
      return fallback;
    }
  }

  /// Warms the caches the dashboard reads.
  ///
  /// Every step is individually guarded AND time-boxed, so this future always
  /// completes. A failure degrades to an empty cache the dashboard fills in
  /// later, never to a screen that cannot be left.
  Future<void> _prepareSession() async {
    final uid = widget.user.uid;

    // First, and awaited: every deadline below is derived from it. The probe
    // is itself time-boxed at one second and cannot throw, so this adds a
    // bounded, usually sub-millisecond step to a path that was already
    // willing to spend twenty-four seconds.
    _online = await ConnectivityProbe.isOnline();

    await _guard(
      'clear stale property cache',
      () => PropertyStorage.clearIfUserMismatch(uid),
      fallback: null,
    );

    await _guard(
      'load profile',
      () => UserProfileService.instance.load(),
      fallback: null,
    );

    // The read above is the FIRST value, awaited so the dashboard opens with a
    // name rather than a dash. This is every value after it: the profile
    // document is written by the admin portal as well as by this device — the
    // registered name and the property behind it are the office's to correct —
    // and without a listener those corrections waited for the next cold start.
    try {
      UserProfileService.instance.startListening();
    } catch (_) {
      // The one-shot read above still stands; the header just stops updating
      // live. Never a reason to hold up the dashboard.
    }

    try {
      LocalDataStore.instance.startListening();
    } catch (_) {
      // Announcements simply stay empty.
    }

    // ── PUSH REGISTRATION ────────────────────────────────────────────────
    // Here, and not in `main()`, for two reasons. It needs a signed-in uid
    // to key the token by, and the permission prompt should arrive after the
    // resident has seen what the app is for — a dialog on first launch is
    // the one most reliably denied, and the denial sticks.
    //
    // NOT awaited. `start()` makes a platform round trip and a Firestore
    // write, and the dashboard has no reason to wait for either; the method
    // swallows its own failures. See PushRegistration for why every push the
    // backend has sent so far hit its `no-token` branch.
    unawaited(PushRegistration.instance.start());

    // The property-verification read that used to end this method is gone with
    // the screen it chose between. It spent an 8-second-guarded Firestore round
    // trip on every cold start answering a question nothing asks any more.
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _sessionReady,
      // `hasData` is never true for a void future, so completion is read off
      // the connection state instead.
      builder: (context, snapshot) => _SplashHandoff(
        child: snapshot.connectionState != ConnectionState.done
            ? const _StartupLoading(key: ValueKey('splash'))
            : _home(),
      ),
    );
  }

  Widget _home() {

        // ── NO PROPERTY BRANCH ANY MORE ────────────────────────────────────
        //
        // A resident with no saved property used to be sent to the self-serve
        // VerifyPropertyScreen and held there. That screen is gone: the address
        // is collected at sign-up and the HOA office verifies it on the admin
        // dashboard, so there is nothing for the resident to complete and
        // nowhere to hold them. Everyone who is signed in reaches the shell.
        //
        // This does NOT weaken anything. Reporting and panic are gated on
        // ACCOUNT verification, which is a different fact living in
        // `residents/{uid}.verificationStatus` and checked in context: on the
        // report screen, and in the SOS countdown sheet (showSosCountdown),
        // which opens locked — reason plus the main gate's number — for an
        // account observed as pending or rejected (the user's decision,
        // 2026-10-18).
        //
        // The BOUNDARY is firestore.rules: since 2026-10-19 an incidents or
        // panic_alerts create needs isVerifiedResident() (security staff may
        // still file incidents). The checks here explain the refusal before
        // the write; a refused SOS still lands on the locked sheet.

        // HomeScreen is reached by BEING built here, not by navigating to it.
        // The shell is NOT wrapped in AccountVerificationGate.
        //
        // It used to be, which meant a resident whose account was still
        // `pending` never saw the app at all — they got the locked "Account
        // Pending Verification" card and nothing else, indefinitely, until a
        // staff member approved them. Since the very first admin has to be
        // seeded by hand (see functions/index.js), a fresh deployment had
        // literally no way for anyone to get in.
        //
        // Letting them in is fine because the two privileged actions are
        // gated where they happen (see the note above). A pending resident can
        // browse the dashboard, see the map, read announcements and watch
        // their own status badge flip to Verified live, but cannot file a
        // report or raise an SOS until staff approve them.
        return const HomeScreen(key: ValueKey('home'));
  }
}

/// The splash dissolving into the dashboard instead of being swapped out.
///
/// The cold start used to cut straight from the emblem to the shell on the
/// frame the session finished loading — a hard jump between two unrelated
/// layouts. Now the dashboard fades in over the splash with a 2% settle, the
/// same entrance vocabulary SplashView itself uses, so the start-up reads as
/// one continuous surface. Instant under reduced motion.
class _SplashHandoff extends StatelessWidget {
  const _SplashHandoff({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.disableAnimationsOf(context);
    return AnimatedSwitcher(
      duration: Duration(milliseconds: reduce ? 0 : 380),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeIn,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.98, end: 1).animate(animation),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

/// The busy screen shown for every pre-dashboard wait: the splash, continued.
///
/// ── WHY THIS IS THE SPLASH AND NOT A LONE LEAF ────────────────────────────
/// This screen is the FIRST FRAME of a cold start. The root route is this
/// gate, not `/splash`, so whatever renders here is the app's first landing
/// page in practice — which makes it the place the brand emblem has to be, or
/// the designed splash is a screen no resident ever reaches.
///
/// It used to be a single 26px turning leaf on a gradient, and the reasoning
/// for stripping it that far is recorded in the git history: the 84px shield
/// tile it carried was the same tile SplashScreen drew, at the same size, in
/// the same place, so drawing it again here read as the splash failing to
/// advance rather than as continuity.
///
/// That argument does not survive the emblem-only redesign, for two reasons.
/// The tile was a stand-in glyph, and two screens showing the same *stand-in*
/// really is just a screen that has not changed; the real mark reading as
/// continuous is the point of a splash. And both surfaces now come from one
/// widget — [SplashView] — rather than from two hand-built columns that
/// happened to look alike, so "identical" is enforced instead of hoped for.
///
/// `animateIn: false` is the load-bearing argument. The entrance fade belongs
/// to the moment the emblem appears; replaying it every time this gate rebuilds
/// into a new wait phase (auth stream, then the per-user session reads) would
/// pulse the logo two or three times on a slow start, which is the flicker the
/// redesign is meant to remove.
///
/// ── WHAT THIS GIVES UP ────────────────────────────────────────────────────
/// The same cost the leaf version carried, restated: a genuinely stuck
/// start-up is now a motionless emblem with nothing naming what stalled. The
/// reads behind this screen are individually time-boxed — see
/// [_SignedInRouterState._stepTimeout] — so an unreachable server degrades to
/// the dashboard in eight seconds rather than waiting here forever, and the
/// account gate downstream swaps itself for an error screen with retry after
/// twelve. The case left uncovered is a wait that is slow but not stuck.
class _StartupLoading extends StatelessWidget {
  const _StartupLoading({super.key});

  /// Whether the splash has already been on screen this process.
  ///
  /// The native launch screens (Android's system splash, iOS's storyboard)
  /// now show only the white canvas, so the FIRST splash Flutter draws is the
  /// logo's entrance and fades it in. Every later wait — the hand-off from
  /// the auth stream to the session load — is the same logo continuing, and
  /// must not replay the entrance: that replay is a flicker, and was one
  /// half of the "duplicated logo" report.
  static bool _shown = false;

  @override
  Widget build(BuildContext context) {
    final first = !_shown;
    _shown = true;
    return SplashView(animateIn: first);
  }
}

/// The failure screen: a mark, and words.
///
/// This one KEEPS both, and the distinction from [_StartupLoading] is the
/// point. That screen drops everything because a wait explains itself and then
/// ends; a failure does neither. There is nothing for the resident to watch and
/// nothing coming, so the sentence saying what broke is the only useful thing
/// on screen — and the tile above it stays visible even if the text fails to
/// lay out, so a terminal error is never a featureless white rectangle.
class _StartupMessage extends StatelessWidget {
  const _StartupMessage({required this.title, this.message});

  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return GradientScaffold(
      body: SizedBox.expand(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  color: AppColors.accentPrimary,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(
                  Icons.warning_amber_rounded,
                  size: 42,
                  color: AppColors.background,
                ),
              ),
              const SizedBox(height: 26),
              Text(
                title,
                textAlign: TextAlign.center,
                style: sfPro(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onGlassPrimary,
                ),
              ),
              if (message != null) ...[
                const SizedBox(height: 10),
                Text(
                  message!,
                  textAlign: TextAlign.center,
                  style: sfPro(
                    fontSize: 13.5,
                    height: 1.45,
                    color: AppColors.onGlassSecondary,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
