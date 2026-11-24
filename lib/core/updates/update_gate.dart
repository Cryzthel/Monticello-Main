import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/updates/app_release.dart';
import 'package:monticello_villas_app/core/updates/update_service.dart';

/// Sits in `MaterialApp.builder` and updates the app WITHOUT any screen of
/// its own (2026-10-30, by request: no in-app update modals — the phone's own
/// system prompts only).
///
/// When [UpdateService] finds a newer build (checked in `main()` before the
/// first frame, and again on each return to the foreground):
///
///   1. On Wi-Fi, it downloads the APK in the background and checks it
///      against the published SHA-256. Not on mobile data: the APK is over
///      100 MB, and nobody agreed to spend that much of a prepaid load.
///   2. If Android does not yet let this app install packages, it opens the
///      system "Install unknown apps" page for this app — once per launch.
///   3. It hands the file to Android's package installer, whose own dialog
///      ("Do you want to update this app?") is the only prompt the resident
///      sees. Cancelling it is the resident's answer for this launch.
///
/// Every step is best-effort and silent on failure: an update must never
/// get in the way of the app, least of all of its SOS button.
class UpdateGate extends StatefulWidget {
  const UpdateGate({super.key, required this.child});

  final Widget child;

  @override
  State<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends State<UpdateGate> with WidgetsBindingObserver {
  final _service = UpdateService.instance;

  /// One attempt per launch: a cancelled installer is not re-opened on every
  /// trip back to the foreground.
  bool _attempted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _service.addListener(_onServiceChanged);
    // Normally already answered in main(); this covers a slow network there.
    unawaited(_service.check().then((_) => _maybeUpdate()));
  }

  @override
  void dispose() {
    _service.removeListener(_onServiceChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Also how an install waiting on "Install unknown apps" carries on: the
    // service re-reads the permission on resume and opens the installer.
    if (state == AppLifecycleState.resumed) unawaited(_service.onResume());
  }

  void _onServiceChanged() => unawaited(_maybeUpdate());

  Future<void> _maybeUpdate() async {
    if (_attempted || _service.urgency == UpdateUrgency.none || _service.busy) return;
    if (!await _onWifi()) return;
    if (_attempted) return;
    _attempted = true;
    // Downloads, verifies, then either opens the installer or — when the
    // permission is missing — the system settings page for it.
    await _service.startUpdate();
  }

  static Future<bool> _onWifi() async {
    try {
      final result = await Connectivity().checkConnectivity();
      return result == ConnectivityResult.wifi || result == ConnectivityResult.ethernet;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
