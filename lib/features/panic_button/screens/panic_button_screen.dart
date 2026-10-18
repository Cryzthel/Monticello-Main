import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/core/theme/app_icons.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/features/contact/widgets/hoa_contact_sheet.dart';
import 'package:monticello_villas_app/features/panic_button/models/sos_payload.dart';
import 'package:monticello_villas_app/features/panic_button/services/panic_alert_service.dart';
import 'package:monticello_villas_app/features/panic_button/services/sos_sms_fallback.dart';

// ═══════════════════════════════════════════════════════════════════════════
// Emergency SOS — light, minimal layout matching the design reference:
//   • compact top bar (back button left, status pill right)
//   • bold "What happened?" heading + helper subtitle
//   • large coral SOS button with soft concentric rings, vertically centered
//   • "Edit" link pinned at the lower-left
// Behaviour is preserved: tap arms a 5-second countdown; double-tap during the
// countdown cancels it. The whole screen scrolls so it never overflows on
// small / short devices and stays inside the safe area.
// ═══════════════════════════════════════════════════════════════════════════

// Emergency reds, now drawn from the shared palette.
//
// These were a private coral pair (#F15B43 / #E0381F) picked to glow against
// the old near-black shell. On the Soft Modernism white surface that coral goes
// pale and loses its urgency, so both now resolve through [AppColors] — one
// definition of "this is an emergency" for the whole app.
const Color _coralLight = Color(0xFFEF4444); // red-500
const Color _coralDark = AppColors.panicOxblood; // red-600

TextStyle _t({
  double size = 15,
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

class PanicButtonScreen extends StatefulWidget {
  const PanicButtonScreen({super.key});

  @override
  State<PanicButtonScreen> createState() => _PanicButtonScreenState();
}

class _PanicButtonScreenState extends State<PanicButtonScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  Timer? _countdownTimer;
  bool _dispatched = false;
  bool _arming = false;
  bool _sending = false;
  bool _failed = false;
  /// Recorded on this device, not yet acknowledged by the server. A real,
  /// reassuring state in its own right — NOT a flavour of failure.
  bool _queued = false;
  SosPayload? _queuedPayload;
  bool _smsOffered = false;
  int _secondsLeft = 5;

  /// True once the emergency exists somewhere durable, whichever channel got
  /// it there. Everything the button looks like keys off this rather than off
  /// [_dispatched] alone.
  bool get _recorded => _dispatched || _queued;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  // ── Countdown / dispatch logic (unchanged behaviour) ───────────────────────
  void _startCountdown() {
    if (_sending || _arming || _recorded) return;
    HapticFeedback.mediumImpact();
    setState(() {
      _arming = true;
      _failed = false;
      _secondsLeft = 5;
    });
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) async {
      if (!mounted) return;
      if (_secondsLeft <= 1) {
        timer.cancel();
        await _dispatch();
        return;
      }
      setState(() => _secondsLeft -= 1);
    });
  }

  void _cancelCountdown() {
    _countdownTimer?.cancel();
    HapticFeedback.mediumImpact();
    setState(() {
      _arming = false;
      _secondsLeft = 5;
    });
  }

  Future<void> _dispatch() async {
    _countdownTimer?.cancel();
    setState(() {
      _arming = false;
      _sending = true;
      _failed = false;
    });

    try {
      final payload =
          await PanicAlertService.buildPayload(emergencyType: 'general');
      final outcome = await PanicAlertService.dispatchPayload(payload);
      if (!mounted) return;
      setState(() {
        _sending = false;
        _dispatched = outcome == SosDispatchOutcome.delivered;
        _queued = outcome == SosDispatchOutcome.queued;
        _queuedPayload = _queued ? payload : null;
      });
      HapticFeedback.heavyImpact();
    } catch (_) {
      // The only remaining failure is being unable to build the payload at
      // all — no signed-in resident. Everything else is queued, not lost.
      if (!mounted) return;
      setState(() {
        _sending = false;
        _failed = true;
      });
      HapticFeedback.heavyImpact();
    }
  }

  /// Opens the SMS composer pre-filled with the queued alert.
  ///
  /// Offered, never automatic. The app cannot send an SMS on the resident's
  /// behalf on either platform (see SosSmsFallback), so presenting it as a
  /// choice is the only version of this that is true — and it keeps the
  /// resident's own credit and their own number on the message, which is what
  /// the guardhouse can call back.
  Future<void> _sendSmsFallback() async {
    final payload = _queuedPayload;
    if (payload == null) return;
    final opened = await SosSmsFallback.compose(payload);
    if (!mounted) return;
    setState(() => _smsOffered = opened);
  }

  // ── Copy that adapts to the current state ──────────────────────────────────
  /// ── EVERY LINE HERE IS A CLAIM THE APP CAN STAND BEHIND ─────────────────
  ///
  /// The dispatched state used to read "Security has been notified — ETA 2
  /// minutes." Neither half of that is something this screen knows. The write
  /// succeeding means the alert reached Firestore, not that a guard has read
  /// it, and nothing anywhere produces an ETA — the two minutes was a constant.
  /// A fabricated promise is bad copy on any screen and a safety problem on
  /// this one: a resident who believes help arrives in two minutes waits
  /// instead of calling.
  ///
  /// What replaces it is what actually happened, plus what the resident can do
  /// next. Reassurance comes from specifics — your name, your address, your
  /// location — not from a countdown nobody is running.
  String get _subtitle {
    if (_dispatched) {
      return 'Alert sent. The guardhouse has your name, address and location. '
          'Stay where you are if it is safe to do so.';
    }
    // ── THE OFFLINE LINE HAS TO CARRY ITS OWN WEIGHT ───────────────────
    // A resident reading this has no signal and is deciding, right now,
    // whether to keep waiting or go and find help another way. The copy has
    // to answer that without overclaiming: it says what is definitely true
    // (recorded on this phone, will send itself), what is not yet true (the
    // guardhouse has not seen it), and what they can do in the meantime. The
    // one thing it must never say is "sent".
    if (_queued) {
      return 'No signal. Your alert is saved on this phone and will send '
          'itself the moment you are back in range — the guardhouse has not '
          'seen it yet. Text or call the hotline below if you can.';
    }
    if (_failed) {
      return 'Alert not sent. Tap the button to retry, or call the security '
          'hotline below.';
    }
    if (_sending) return 'Sending your alert to the guardhouse…';
    if (_arming) {
      return 'Sending in $_secondsLeft second${_secondsLeft == 1 ? '' : 's'}. '
          'Double-tap to cancel.';
    }
    return 'Tap the button to alert the guardhouse. You will have five seconds '
        'to cancel.';
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            // ── SCROLLS NOW ─────────────────────────────────────────────
            //
            // The button used to sit in an Expanded, centred in whatever height
            // was left. That works for a screen with nothing under it; the
            // guidance cards below have to be reachable, so the column scrolls
            // and the button keeps a generous fixed block of air instead.
            //
            // `AlwaysScrollableScrollPhysics` so the gesture works even on a
            // tall device where the content happens to fit — a screen that
            // sometimes scrolls and sometimes does not is a screen whose
            // content a resident may never find.
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildTopBar(context),
                  const SizedBox(height: 24),
                  _buildHeading(),
                  const SizedBox(height: 28),
                  Center(child: _buildSosButton()),
                  const SizedBox(height: 32),
                  _buildGuidance(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── Top bar: back button only ──────────────────────────────────────────────
  Widget _buildTopBar(BuildContext context) {
    return const Align(
      alignment: Alignment.centerLeft,
      child: ModernBackButton(),
    );
  }

  // ── Heading block ──────────────────────────────────────────────────────────
  Widget _buildHeading() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // "What happened?" was the heading. It is a question this screen has no
        // way to answer — there is one button and no categories — so it asked
        // a resident in distress to compose a reply to nothing. The heading now
        // names the tool.
        Text(
          'Emergency SOS',
          style: _t(size: 30, weight: FontWeight.w800, spacing: -0.5),
        ),
        const SizedBox(height: 8),
        Text(
          _subtitle,
          style: _t(size: 15, color: AppColors.textSecondary, height: 1.45),
        ),
      ],
    );
  }


  // ── SCANNABLE CARDS ─────────────────────────────────────────────────────
  //
  // Three cards, in the order the questions occur to someone in trouble:
  // what am I about to send, what happens after I send it, and what if I
  // cannot wait. Each is a short titled block with one idea per line — the
  // structure a person can take in while their attention is somewhere else,
  // which is the only reading condition this screen is ever used in.
  //
  // Deliberately BELOW the button. The button is the action; anything placed
  // above it is something a resident has to scroll past in an emergency.

  Widget _sectionCard({
    required IconData icon,
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: AppColors.borderNeutralSoft,
          width: AppStroke.hairline,
        ),
        boxShadow: AppShadows.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: _coralDark),
              const SizedBox(width: 8),
              Text(
                title,
                style: _t(size: 13, weight: FontWeight.w700, spacing: 0.2),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }

  /// One fact the alert carries. Ticked, because each of these is something
  /// already known — not something the resident has to supply.
  Widget _factRow(String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(PhosphorIconsFill.checkCircle,
              size: 15, color: AppColors.success),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: _t(size: 13.5, color: AppColors.textSecondary, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  /// One step of what happens after sending. Numbered rather than bulleted:
  /// these occur in order, and the order is the reassurance.
  Widget _stepRow(int number, String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 20,
            height: 20,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _coralDark.withValues(alpha: 0.12),
            ),
            child: Text(
              '$number',
              style: _t(size: 11, weight: FontWeight.w800, color: _coralDark),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: _t(size: 13.5, color: AppColors.textSecondary, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }

  /// A number a resident can press. `tel:` rather than plain text — reading a
  /// number off a screen and typing it is the slowest possible step here.
  Widget _callRow({required String label, required String number}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.sm),
        onTap: () => _dial(number),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _coralDark.withValues(alpha: 0.12),
                ),
                child: const Icon(PhosphorIconsFill.phoneCall,
                    size: 16, color: _coralDark),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label,
                        style: _t(size: 13.5, weight: FontWeight.w600)),
                    const SizedBox(height: 1),
                    Text(number,
                        style: _t(
                            size: 12.5,
                            color: AppColors.textSecondary,
                            height: 1.3)),
                  ],
                ),
              ),
              const Icon(AppIcons.chevronRight,
                  size: 14, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _dial(String number) async {
    final uri = HoaContact.dialUri(number);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // No dialer (a tablet, an emulator). The number is on screen either way,
      // which is why this fails quietly rather than raising a message over an
      // emergency screen.
    }
  }

  /// Shown only while an alert is sitting in the queue.
  ///
  /// It is placed FIRST, above the standing guidance, because it is the only
  /// part of this screen that is about the resident's situation right now
  /// rather than about how the feature works in general.
  Widget _buildOfflineCard() {
    final payload = _queuedPayload;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Ink, not the fill, for BOTH the glyph and the label.
              //
              // This card sits on `warning @ 10%` (#FEF5E7), and amber-500
              // measures 1.99:1 against it — the lowest-contrast text in the
              // app, on the one screen where the resident is already in
              // trouble and the network is gone. The ink measures 6.56:1 on
              // that same wash.
              //
              // The glyph steps down with the label rather than keeping the
              // fill hue: cloudSlash is what tells the resident the alert has
              // not left the phone, so it is meaningful content and owes the
              // 3:1 that non-text UI is held to. At 1.99:1 it did not pay it.
              const Icon(PhosphorIconsFill.cloudSlash,
                  color: AppColors.warningInk, size: 18),
              const SizedBox(width: 8),
              Text('SAVED ON THIS PHONE',
                  style: _t(
                      size: 11,
                      weight: FontWeight.w800,
                      color: AppColors.warningInk,
                      spacing: 1)),
            ],
          ),
          const SizedBox(height: 10),
          // Concrete, checkable statements only. "Encrypted" and "keeps
          // retrying" are things the code actually does; there is deliberately
          // no estimate of when it will get through, because nothing here
          // knows that.
          _stepRow(1, 'Your alert is stored encrypted on this device — closing '
              'the app or restarting your phone will not lose it.'),
          _stepRow(2, 'It sends itself automatically the moment you have data '
              'again. You do not need to come back to this screen.'),
          _stepRow(3, 'Until then the guardhouse has not seen it. If you have '
              'any bars at all, send the text below or call.'),
          const SizedBox(height: 4),
          if (payload != null)
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _smsOffered ? null : _sendSmsFallback,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.warning,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor:
                      AppColors.warning.withValues(alpha: 0.35),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                ),
                icon: const Icon(PhosphorIconsFill.chatText, size: 18),
                // The label promises exactly what the tap does. It opens a
                // prepared message; the resident presses send. Neither iOS nor
                // Play will let an app do that last part for them, so saying
                // "Send" here would be the app taking credit for something a
                // carrier never accepted.
                label: Text(
                  _smsOffered
                      ? 'Text message prepared'
                      : 'Text the guardhouse instead',
                  style: _t(
                      size: 13.5,
                      weight: FontWeight.w700,
                      color: Colors.white),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildGuidance() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_queued) _buildOfflineCard(),
        _sectionCard(
          icon: PhosphorIconsFill.paperPlaneTilt,
          title: 'WHAT YOUR ALERT SENDS',
          children: [
            _factRow('Your name and registered address'),
            _factRow('Your live GPS position, when location is available'),
            _factRow('The exact time the alert was raised'),
          ],
        ),
        const SizedBox(height: 12),
        _sectionCard(
          icon: PhosphorIconsFill.shieldCheck,
          title: 'WHAT HAPPENS NEXT',
          children: [
            _stepRow(1, 'The alert appears on the guardhouse dispatch map the '
                'moment it is sent.'),
            _stepRow(2, 'The officer on duty acknowledges it, and their name is '
                'recorded against your alert.'),
            _stepRow(3, 'A responder is sent to your location. Keep your phone '
                'with you.'),
          ],
        ),
        const SizedBox(height: 12),
        _sectionCard(
          icon: PhosphorIconsFill.phoneCall,
          title: 'IF YOU NEED SOMEONE NOW',
          children: [
            _callRow(
              label: 'Main gate guard',
              number: HoaContact.mainGateNumber,
            ),
            _callRow(
              label: 'HOA office',
              number: HoaContact.officeNumber,
            ),
            const SizedBox(height: 2),
            Text(
              'For fire, medical or police emergencies, call the national '
              'emergency hotline 911 first, then raise this alert so the '
              'guardhouse can meet responders at the gate.',
              style: _t(
                  size: 12.5, color: AppColors.textSecondary, height: 1.45),
            ),
          ],
        ),
      ],
    );
  }

  // ── SOS button with soft concentric rings ──────────────────────────────────
  Widget _buildSosButton() {
    // Green means the guardhouse has it. Amber means this phone has it and
    // is still trying. Neither is red, because red on this screen means
    // "nothing has happened yet" — and once the payload is on disk, something
    // has.
    final accent = _dispatched
        ? AppColors.success
        : _queued
            ? AppColors.warning
            : _coralDark;
    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, _) {
        final scale = 1 + _pulse.value * (_arming ? 0.08 : 0.04);
        return SizedBox(
          width: 280,
          height: 280,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Outer pulsing ring.
              Transform.scale(
                scale: scale,
                child: _ring(260, accent.withValues(alpha: 0.06)),
              ),
              _ring(210, accent.withValues(alpha: 0.10)),
              // Main button.
              GestureDetector(
                onTap: _startCountdown,
                // Double-tap during the countdown cancels immediately.
                onDoubleTap: _arming ? _cancelCountdown : null,
                child: Container(
                  width: 168,
                  height: 168,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      center: const Alignment(-0.3, -0.4),
                      radius: 0.9,
                      colors: _dispatched
                          ? const [Color(0xFF34D399), Color(0xFF059669)]
                          : _queued
                              ? const [Color(0xFFFBBF24), Color(0xFFD97706)]
                              : const [_coralLight, _coralDark],
                    ),
                    // ── DELIBERATELY NOT NEUTRALISED ──────────────────────
                    //
                    // Every other coloured shadow in the app went grey. This
                    // one is exempt, along with the SOS disc in the nav bar,
                    // because it is not elevation — it is STATE on an
                    // emergency control. Red while armed says "this is the
                    // dangerous one"; green after dispatch says "help is
                    // coming", which is the single most important thing this
                    // screen ever tells a resident. Greying it would quietly
                    // downgrade a safety cue to satisfy a styling rule.
                    boxShadow: [
                      BoxShadow(
                        color: accent.withValues(alpha: 0.45),
                        blurRadius: 28,
                        spreadRadius: 1,
                        offset: const Offset(0, 10),
                      ),
                    ],
                  ),
                  child: Center(child: _buildButtonLabel()),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _ring(double size, Color color) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(shape: BoxShape.circle, color: color),
    );
  }

  Widget _buildButtonLabel() {
    if (_failed) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(PhosphorIconsFill.warning, color: Colors.white, size: 36),
          const SizedBox(height: 2),
          Text('TAP TO RETRY',
              style: _t(
                  size: 12,
                  weight: FontWeight.w800,
                  color: Colors.white,
                  spacing: 1)),
        ],
      );
    }
    if (_queued) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(PhosphorIconsFill.clockCountdown,
              color: Colors.white, size: 40),
          const SizedBox(height: 2),
          Text('SAVED',
              style: _t(
                  size: 14,
                  weight: FontWeight.w800,
                  color: Colors.white,
                  spacing: 2)),
          Text('WILL SEND WHEN ONLINE',
              style: _t(
                  size: 7.5,
                  weight: FontWeight.w700,
                  color: Colors.white.withValues(alpha: 0.9),
                  spacing: 0.5)),
        ],
      );
    }
    if (_dispatched) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(PhosphorIconsFill.check, color: Colors.white, size: 44),
          const SizedBox(height: 2),
          Text('SENT',
              style: _t(
                  size: 14,
                  weight: FontWeight.w800,
                  color: Colors.white,
                  spacing: 2)),
        ],
      );
    }
    if (_sending) {
      return Text('SENDING…',
          style: _t(size: 15, weight: FontWeight.w800, color: Colors.white));
    }
    if (_arming) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$_secondsLeft',
              style: _t(size: 52, weight: FontWeight.w800, color: Colors.white)),
          Text('DOUBLE-TAP TO CANCEL',
              style: _t(
                  size: 8.5,
                  weight: FontWeight.w700,
                  color: Colors.white.withValues(alpha: 0.85),
                  spacing: 0.6)),
        ],
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('SOS',
            style: _t(
                size: 38,
                weight: FontWeight.w800,
                color: Colors.white,
                spacing: 2)),
        const SizedBox(height: 2),
        Text('TAP TO ALERT',
            style: _t(
                size: 9,
                weight: FontWeight.w700,
                color: Colors.white.withValues(alpha: 0.85),
                spacing: 1.2)),
      ],
    );
  }

}

