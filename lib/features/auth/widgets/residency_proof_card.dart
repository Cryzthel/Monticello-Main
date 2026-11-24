import 'dart:io';

import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';
import 'package:monticello_villas_app/features/auth/services/verification_document_service.dart';
import 'package:monticello_villas_app/features/media/widgets/photo_evidence_dropzone.dart';

/// Where the chosen HOA ID / proof of residency is in its life.
enum IdUploadStatus {
  /// Nothing chosen yet.
  none,

  /// Chosen and valid, waiting for the account to exist so it can upload.
  ready,
  uploading,
  uploaded,
  failed,
}

/// The HOA ID / Proof of Residency step of registration.
///
/// ── THE SAME UPLOADER AS PROOF OF EVIDENCE ────────────────────────────────
/// Empty, this IS the incident report's [PhotoEvidenceDropzone]: the same
/// dashed box, cloud icon, height and press. Filled, a preview takes exactly
/// that box — same size, same dashed edge, the same red remove disc the
/// evidence thumbnails carry — so the two places a resident hands the estate
/// a file are one component, not two that resemble each other.
///
/// ── ONE HEIGHT IN EVERY STATE ─────────────────────────────────────────────
/// Empty, chosen, uploading, uploaded and failed are all
/// [PhotoEvidenceDropzone.defaultHeight] tall, so choosing a file never moves
/// the submit button under the resident's thumb.
class ResidencyProofCard extends StatelessWidget {
  const ResidencyProofCard({
    super.key,
    required this.file,
    required this.fileName,
    required this.bytes,
    required this.status,
    required this.onPick,
    required this.onRemove,
    this.progress,
    this.error,
    this.enabled = true,
  });

  final File? file;

  /// What the resident picked it as — shown for a PDF, which has no preview.
  final String? fileName;
  final int? bytes;
  final IdUploadStatus status;
  final VoidCallback onPick;
  final VoidCallback onRemove;

  /// 0..1 while [IdUploadStatus.uploading], when the transfer reports it.
  final double? progress;

  /// Wrong format, too large, or a reminder that the step is required.
  final String? error;
  final bool enabled;

  bool get _locked =>
      !enabled ||
      status == IdUploadStatus.uploading ||
      status == IdUploadStatus.uploaded;

  @override
  Widget build(BuildContext context) {
    final body = file == null
        ? PhotoEvidenceDropzone(
            key: const ValueKey('empty'),
            onTap: _locked ? null : onPick,
            hasError: error != null,
            title: 'Tap to upload your ID',
            subtitle: VerificationIdRules.requirementsLabel,
          )
        : _Preview(
            key: ValueKey(file!.path),
            file: file!,
            fileName: fileName,
            bytes: bytes,
            status: status,
            progress: progress,
            hasError: error != null || status == IdUploadStatus.failed,
            onReplace: _locked ? null : onPick,
            onRemove: _locked ? null : onRemove,
          );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          switchInCurve: Curves.easeOut,
          switchOutCurve: Curves.easeIn,
          child: body,
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          alignment: Alignment.topCenter,
          child: error != null
              ? Padding(
                  padding: const EdgeInsets.only(top: 6, left: 14, right: 14),
                  child: Text(
                    error!,
                    style: sfPro(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: AppColors.danger,
                    ),
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

class _Preview extends StatelessWidget {
  const _Preview({
    super.key,
    required this.file,
    required this.fileName,
    required this.bytes,
    required this.status,
    required this.progress,
    required this.hasError,
    required this.onReplace,
    required this.onRemove,
  });

  final File file;
  final String? fileName;
  final int? bytes;
  final IdUploadStatus status;
  final double? progress;
  final bool hasError;
  final VoidCallback? onReplace;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final isPdf = VerificationIdRules.isPdf(file.path);
    final stroke = hasError
        ? AppColors.danger.withValues(alpha: 0.55)
        : AppColors.onGlassMuted.withValues(alpha: 0.55);
    const radius = PhotoEvidenceDropzone.radius;

    return SizedBox(
      height: PhotoEvidenceDropzone.defaultHeight,
      child: DashedOutline(
        color: stroke,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(radius),
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (isPdf)
                _PdfFace(name: fileName, bytes: bytes)
              else
                Image.file(
                  file,
                  fit: BoxFit.cover,
                  // Decoded near the size it is drawn, not at the camera's
                  // 4000px — a full-width preview on a 3x screen.
                  cacheWidth: 1080,
                  gaplessPlayback: true,
                  semanticLabel: 'Preview of your ID',
                  errorBuilder: (_, __, ___) =>
                      _PdfFace(name: fileName, bytes: bytes, unreadable: true),
                ),

              // Dims the preview under the progress readout while uploading.
              AnimatedOpacity(
                opacity: status == IdUploadStatus.uploading ? 1 : 0,
                duration: const Duration(milliseconds: 200),
                child: const ColoredBox(color: Color(0x66000000)),
              ),
              if (status == IdUploadStatus.uploading)
                Center(child: _UploadingReadout(progress: progress)),

              // The same remove disc the evidence thumbnails carry.
              if (onRemove != null)
                Positioned(
                  top: 0,
                  right: 0,
                  child: MediaRemoveButton(
                    semanticLabel: 'Remove ID',
                    onTap: onRemove!,
                  ),
                ),

              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _StatusBar(
                  status: status,
                  progress: progress,
                  onReplace: onReplace,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A PDF has nothing to preview, so its face is the file itself: the icon the
/// dropzone uses for "a document", its name and its size.
class _PdfFace extends StatelessWidget {
  const _PdfFace({required this.name, required this.bytes, this.unreadable = false});

  final String? name;
  final int? bytes;
  final bool unreadable;

  @override
  Widget build(BuildContext context) {
    final size = bytes == null ? null : VerificationIdRules.formatSize(bytes!);
    return ColoredBox(
      color: AppColors.glassFill,
      child: Padding(
        // Clear of the status bar along the bottom.
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 44),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              unreadable ? PhosphorIconsFill.fileX : PhosphorIconsFill.filePdf,
              size: 44,
              color: AppColors.primaryDark,
            ),
            const SizedBox(height: 10),
            Text(
              name ?? 'Document',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: sfPro(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: AppColors.onGlassSecondary,
              ),
            ),
            if (size != null) ...[
              const SizedBox(height: 2),
              Text(size,
                  style: sfPro(fontSize: 11.5, color: AppColors.onGlassMuted)),
            ],
          ],
        ),
      ),
    );
  }
}

class _UploadingReadout extends StatelessWidget {
  const _UploadingReadout({required this.progress});

  final double? progress;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const LeafLoader(size: 28, color: Colors.white),
        const SizedBox(height: 8),
        Text(
          progress == null
              ? 'Uploading…'
              : 'Uploading ${(progress! * 100).clamp(0, 99).round()}%',
          style: sfPro(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
      ],
    );
  }
}

/// The strip along the bottom of the preview: what state the file is in, and
/// Replace. The same dark band the evidence thumbnails use for their
/// "Watermarked" caption, grown to a 40pt row that can hold a button.
class _StatusBar extends StatelessWidget {
  const _StatusBar({
    required this.status,
    required this.progress,
    required this.onReplace,
  });

  final IdUploadStatus status;
  final double? progress;
  final VoidCallback? onReplace;

  @override
  Widget build(BuildContext context) {
    final (String label, IconData icon, Color color) = switch (status) {
      IdUploadStatus.uploading => (
          'Uploading',
          PhosphorIconsFill.cloudArrowUp,
          Colors.white,
        ),
      IdUploadStatus.uploaded => (
          'Uploaded',
          PhosphorIconsFill.checkCircle,
          const Color(0xFF6EE7B7), // emerald-300: legible on the dark band
        ),
      IdUploadStatus.failed => (
          'Upload failed',
          PhosphorIconsFill.warningCircle,
          const Color(0xFFFCA5A5), // red-300, same reason
        ),
      _ => ('Ready to upload', PhosphorIconsFill.circle, Colors.white70),
    };

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // A determinate bar while the transfer reports progress — the
        // readout in the middle says the number, this shows the distance.
        if (status == IdUploadStatus.uploading)
          LinearProgressIndicator(
            value: progress,
            minHeight: 3,
            backgroundColor: Colors.white24,
            valueColor: const AlwaysStoppedAnimation(Colors.white),
          ),
        Container(
          height: 40,
          padding: const EdgeInsets.only(left: 12),
          color: Colors.black.withValues(alpha: 0.55),
          child: Row(
            children: [
              Semantics(
                liveRegion: true,
                label: 'ID: $label',
                excludeSemantics: true,
                child: Row(
                  children: [
                    Icon(icon,
                        size: status == IdUploadStatus.ready ? 8 : 14,
                        color: color),
                    const SizedBox(width: 6),
                    Text(
                      label,
                      style: sfPro(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: color,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              if (onReplace != null)
                Semantics(
                  button: true,
                  label: 'Replace ID',
                  excludeSemantics: true,
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: onReplace,
                    child: ConstrainedBox(
                      constraints:
                          const BoxConstraints(minWidth: 44, minHeight: 40),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: Center(
                          child: Text(
                            'Replace',
                            style: sfPro(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
