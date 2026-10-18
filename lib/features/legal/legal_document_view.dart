import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/modern_back_button.dart';
import 'package:monticello_villas_app/features/legal/legal_content.dart';

/// One legal document laid out for reading on a phone: a title block with
/// the "Last Updated" date, an intro, then numbered sections with bold
/// headings, comfortable paragraph spacing and real bullet lists.
///
/// Not scrollable by itself, so the Settings reader and the sign-up sheet
/// (which needs its own scroll controller for the read-to-the-end gate) can
/// both host it.
class LegalDocumentBody extends StatelessWidget {
  const LegalDocumentBody({
    super.key,
    required this.document,
    this.showTitle = true,
  });

  final LegalDocument document;

  /// The Settings reader already names the document in its header bar.
  final bool showTitle;

  static TextStyle get _bodyStyle => sfPro(
        fontSize: 14,
        color: AppColors.textSecondary,
        height: 1.6,
      );

  @override
  Widget build(BuildContext context) {
    final doc = document;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showTitle) ...[
          Text(
            doc.title,
            style: sfPro(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.3,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
        ],
        if (doc.lastUpdated != null)
          Text(
            'Last Updated: ${doc.lastUpdated}',
            style: sfPro(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.textMuted,
            ),
          ),
        if (showTitle || doc.lastUpdated != null) const SizedBox(height: 16),
        if (doc.intro != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.accentPrimary.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(
                  color: AppColors.accentPrimary.withValues(alpha: 0.14)),
            ),
            child: Text(doc.intro!, style: _bodyStyle),
          ),
          const SizedBox(height: 24),
        ],
        for (var i = 0; i < doc.sections.length; i++) ...[
          if (i > 0) const SizedBox(height: 24),
          _Section(section: doc.sections[i], bodyStyle: _bodyStyle),
        ],
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.section, required this.bodyStyle});

  final LegalSection section;
  final TextStyle bodyStyle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          section.heading,
          style: sfPro(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
            color: AppColors.textPrimary,
            height: 1.35,
          ),
        ),
        for (final block in section.blocks) ...[
          const SizedBox(height: 10),
          if (block.bullets != null)
            _Bullets(items: block.bullets!, style: bodyStyle)
          else
            _Paragraph(text: block.text!, style: bodyStyle),
        ],
      ],
    );
  }
}

class _Bullets extends StatelessWidget {
  const _Bullets({required this.items, required this.style});

  final List<String> items;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < items.length; i++)
            Padding(
              padding: EdgeInsets.only(top: i == 0 ? 0 : 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Centred on the first line: 14px text at 1.6 leading is a
                  // 22.4px line, so a 6px dot sits 8px down.
                  Container(
                    width: 6,
                    height: 6,
                    margin: const EdgeInsets.only(top: 8, right: 12),
                    decoration: const BoxDecoration(
                      color: AppColors.accentPrimary,
                      shape: BoxShape.circle,
                    ),
                  ),
                  Expanded(child: Text(items[i], style: style)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A paragraph; the privacy address inside it becomes a mailto link.
class _Paragraph extends StatefulWidget {
  const _Paragraph({required this.text, required this.style});

  final String text;
  final TextStyle style;

  @override
  State<_Paragraph> createState() => _ParagraphState();
}

class _ParagraphState extends State<_Paragraph> {
  TapGestureRecognizer? _mail;

  @override
  void dispose() {
    _mail?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final at = widget.text.indexOf(kPrivacyEmail);
    if (at < 0) return Text(widget.text, style: widget.style);

    _mail ??= TapGestureRecognizer()
      ..onTap = () => launchUrl(Uri(scheme: 'mailto', path: kPrivacyEmail));
    return Text.rich(
      TextSpan(
        style: widget.style,
        children: [
          TextSpan(text: widget.text.substring(0, at)),
          TextSpan(
            text: kPrivacyEmail,
            recognizer: _mail,
            style: const TextStyle(
              color: AppColors.accentPrimary,
              fontWeight: FontWeight.w600,
              decoration: TextDecoration.underline,
              decorationColor: AppColors.accentPrimary,
            ),
          ),
          TextSpan(text: widget.text.substring(at + kPrivacyEmail.length)),
        ],
      ),
    );
  }
}

/// The full-screen reader Settings opens for either document.
class LegalDocumentScreen extends StatelessWidget {
  const LegalDocumentScreen({super.key, required this.document});

  final LegalDocument document;

  @override
  Widget build(BuildContext context) {
    // Opaque white rather than the glass shell: long-form legal text stays
    // maximally readable.
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // The app-wide back-button header, title centred against the full
            // width via a Stack — matches the incident report flow.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: SizedBox(
                height: 44,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: ModernBackButton(),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 52),
                      child: Text(
                        document.title,
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: sfPro(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const Divider(height: 1, color: AppColors.borderNeutral),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                    20, 20, 20, MediaQuery.paddingOf(context).bottom + 40),
                child: LegalDocumentBody(document: document, showTitle: false),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
