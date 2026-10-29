import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/updates/app_release.dart';
import 'package:monticello_villas_app/core/updates/update_service.dart';
import 'package:monticello_villas_app/core/widgets/ui_primitives.dart';

/// Sits in `MaterialApp.builder`, above every route, and applies
/// [UpdateService]'s decision:
///
///   required  → [ForcedUpdateScreen] replaces the app. It cannot be
///               dismissed or navigated around; the only way on is the update.
///   optional  → the app as normal, with [_UpdateBanner] over the top of it
///               until the resident updates or taps Later.
///   none      → the app, untouched.
///
/// Checks once at start-up and again whenever the app comes back to the
/// foreground (throttled in the service), which is also how a download that
/// was waiting on "Install unknown apps" carries on by itself.
class UpdateGate extends StatefulWidget {
  const UpdateGate({super.key, required this.child});

  final Widget child;

  @override
  State<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends State<UpdateGate> with WidgetsBindingObserver {
  final _service = UpdateService.instance;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _service.check(force: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _service.onResume();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _service,
      builder: (context, _) {
        if (_service.urgency == UpdateUrgency.required) {
          return ForcedUpdateScreen(service: _service);
        }
        // An update is waiting but Android would refuse to install it: the
        // permission prompt comes first, over a scrim, before the app is used.
        if (_service.offerInstallPermission) {
          return Stack(
            children: [
              widget.child,
              const ModalBarrier(dismissible: false, color: Color(0x8C000000)),
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: _InstallPermissionCard(service: _service),
                ),
              ),
            ],
          );
        }
        return Stack(
          children: [
            widget.child,
            if (_service.offerOptional)
              Positioned(
                left: 12,
                right: 12,
                top: MediaQuery.paddingOf(context).top + 8,
                child: _UpdateBanner(service: _service),
              ),
          ],
        );
      },
    );
  }
}

/// "Allow app updates": the one-time Android permission an in-place update
/// needs, asked for at start-up when an update is waiting and the permission
/// is not yet granted. "Allow" opens this app's "Install unknown apps" page;
/// on return [UpdateService.onResume] re-reads it and the prompt gives way to
/// the update itself.
class _InstallPermissionCard extends StatelessWidget {
  const _InstallPermissionCard({required this.service});

  final UpdateService service;

  @override
  Widget build(BuildContext context) {
    final required = service.urgency == UpdateUrgency.required;
    return Material(
      color: AppColors.background,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 22, 20, 14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(PhosphorIconsFill.shieldCheck, size: 40, color: AppColors.primary),
            const SizedBox(height: 12),
            Text('Allow app updates',
                textAlign: TextAlign.center,
                style: sfPro(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
            const SizedBox(height: 8),
            Text(
              'Version ${service.release?.version ?? ''} is ready. To install it inside the app, '
              'Android needs you to allow Monticello Villas to install updates — once. '
              'Turn on "Allow from this source", then come back.',
              textAlign: TextAlign.center,
              style: sfPro(fontSize: 14, color: AppColors.textSecondary, height: 1.5),
            ),
            const SizedBox(height: 18),
            PrimaryButton(
              label: 'Allow',
              icon: PhosphorIconsBold.gear,
              onPressed: service.openInstallSettings,
            ),
            if (!required) ...[
              const SizedBox(height: 4),
              TextButton(
                onPressed: service.dismissPermissionPrompt,
                child: Text('Not now',
                    style: sfPro(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The hard stop. Shown in place of the whole app, so there is no back button
/// and nothing behind it to reach.
class ForcedUpdateScreen extends StatelessWidget {
  const ForcedUpdateScreen({super.key, required this.service});

  final UpdateService service;

  @override
  Widget build(BuildContext context) {
    final release = service.release!;
    return PopScope(
      canPop: false,
      child: Material(
        color: AppColors.background,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Spacer(),
                Center(
                  child: Container(
                    width: 72,
                    height: 72,
                    decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.surfaceAccentSoft),
                    child: const Icon(PhosphorIconsFill.arrowCircleUp, size: 40, color: AppColors.primary),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'Update required',
                  textAlign: TextAlign.center,
                  style: sfPro(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.textPrimary, letterSpacing: -0.3),
                ),
                const SizedBox(height: 10),
                Text(
                  'This version of Monticello Villas is no longer supported. Install version ${release.version} to keep '
                  'using the app. You stay signed in, and nothing on your phone is lost.',
                  textAlign: TextAlign.center,
                  style: sfPro(fontSize: 14.5, color: AppColors.textSecondary, height: 1.5),
                ),
                const SizedBox(height: 28),
                _UpdateProgress(service: service),
                const Spacer(flex: 2),
                _UpdateActions(service: service, required: true),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The optional prompt: a card over the top of the app.
class _UpdateBanner extends StatelessWidget {
  const _UpdateBanner({required this.service});

  final UpdateService service;

  @override
  Widget build(BuildContext context) {
    final release = service.release!;
    final size = release.sizeBytes;
    return Material(
      color: AppColors.background,
      elevation: 6,
      shadowColor: AppColors.shadowMedium,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(PhosphorIconsFill.arrowCircleUp, color: AppColors.primary, size: 24),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Update available',
                          style: sfPro(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                      Text(
                        'Version ${release.version}${size == null ? '' : ' · ${formatMegabytes(size)}'}',
                        style: sfPro(fontSize: 12.5, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _UpdateProgress(service: service),
            _UpdateActions(service: service, required: false),
          ],
        ),
      ),
    );
  }
}

/// Download progress, the permission step and errors — whatever the current
/// phase has to say. Empty while idle.
class _UpdateProgress extends StatelessWidget {
  const _UpdateProgress({required this.service});

  final UpdateService service;

  @override
  Widget build(BuildContext context) {
    final total = service.release?.sizeBytes;
    switch (service.phase) {
      case UpdatePhase.downloading:
        final received = formatMegabytes(service.receivedBytes);
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: service.progress,
                  minHeight: 8,
                  color: AppColors.primary,
                  backgroundColor: AppColors.neutralFill,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                total == null
                    ? 'Downloading… $received'
                    : 'Downloading… $received of ${formatMegabytes(total)}'
                        '${service.progress == null ? '' : ' (${(service.progress! * 100).round()}%)'}',
                style: sfPro(fontSize: 12.5, color: AppColors.textSecondary),
              ),
            ],
          ),
        );
      case UpdatePhase.needsPermission:
        return const _Note(
          icon: PhosphorIconsFill.shieldCheck,
          color: AppColors.textSecondary,
          text: 'Android needs your permission once: turn on "Allow from this source" for Monticello Villas, '
              'then come back. The update installs straight away.',
        );
      case UpdatePhase.installing:
        return const _Note(
          icon: PhosphorIconsFill.package,
          color: AppColors.textSecondary,
          text: 'Tap Update in the Android installer. The app restarts on the new version.',
        );
      case UpdatePhase.failed:
        return _Note(
          icon: PhosphorIconsFill.warningCircle,
          color: AppColors.dangerInk,
          text: service.error ?? 'The update failed. Try again.',
        );
      case UpdatePhase.idle:
      case UpdatePhase.ready:
        return const SizedBox.shrink();
    }
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: sfPro(fontSize: 13, color: color, height: 1.45))),
        ],
      ),
    );
  }
}

class _UpdateActions extends StatelessWidget {
  const _UpdateActions({required this.service, required this.required});

  final UpdateService service;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final phase = service.phase;
    final primary = service.needsInstallPermission
        // The forced screen asks for the permission in its own action.
        ? PrimaryButton(
            label: 'Allow app updates',
            icon: PhosphorIconsBold.gear,
            onPressed: service.openInstallSettings,
          )
        : switch (phase) {
      UpdatePhase.downloading => const PrimaryButton(label: 'Downloading…', loading: true, onPressed: null),
      UpdatePhase.needsPermission => PrimaryButton(
          label: 'Open settings',
          icon: PhosphorIconsBold.gear,
          onPressed: service.openInstallSettings,
        ),
      UpdatePhase.failed => PrimaryButton(
          label: 'Try again',
          icon: PhosphorIconsBold.arrowClockwise,
          onPressed: service.startUpdate,
        ),
      _ => PrimaryButton(
          label: phase == UpdatePhase.ready || phase == UpdatePhase.installing ? 'Install update' : 'Update now',
          icon: PhosphorIconsBold.downloadSimple,
          onPressed: service.startUpdate,
        ),
    };

    final fallback = service.release?.permanentUrl ?? service.release?.url;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        primary,
        if (!required && !service.busy) ...[
          const SizedBox(height: 8),
          TextButton(
            onPressed: service.dismissOptional,
            child: Text('Later', style: sfPro(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
          ),
        ],
        // The way out when the in-app path keeps failing: the same APK
        // through the browser, as residents installed it the first time.
        if (phase == UpdatePhase.failed && fallback != null) ...[
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => launchUrl(Uri.parse(fallback), mode: LaunchMode.externalApplication),
            child: Text('Download in the browser instead',
                style: sfPro(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.primary)),
          ),
        ],
      ],
    );
  }
}
