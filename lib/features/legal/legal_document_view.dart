import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/page_title_bar.dart';
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

  /// 15 / 1.65. Justified text needs the extra leading more than ragged
  /// text does: stretched word gaps make a line read looser, and tight
  /// leading under it turns the page grey.
  static TextStyle get _bodyStyle => sfPro(
        fontSize: 15,
        color: AppColors.textSecondary,
        height: 1.65,
      );

  /// Every block of running text is justified, by request, so the two
  /// documents set as documents. Flutter leaves each paragraph's LAST line
  /// ragged, which is what keeps a short closing line from being stretched
  /// across the page. Headings stay left-aligned: they are labels, and
  /// justifying a one-line heading does nothing but space it out.
  static const TextAlign bodyAlign = TextAlign.justify;

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
            child: Text(doc.intro!, style: _bodyStyle, textAlign: bodyAlign),
          ),
          const SizedBox(height: 24),
        ],
        for (var i = 0; i < doc.sections.length; i++) ...[
          if (i > 0) const SizedBox(height: 28),
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
            fontSize: 17,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.25,
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
                  // Centred on the first line: 15px text at 1.65 leading is a
                  // 24.75px line, so a 6px dot sits ~9.4px down.
                  Container(
                    width: 6,
                    height: 6,
                    margin: const EdgeInsets.only(top: 9.4, right: 12),
                    decoration: const BoxDecoration(
                      color: AppColors.accentPrimary,
                      shape: BoxShape.circle,
                    ),
                  ),
                  Expanded(
                    child: Text(items[i],
                        style: style,
                        textAlign: LegalDocumentBody.bodyAlign),
                  ),
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
    if (at < 0) {
      return Text(widget.text,
          style: widget.style, textAlign: LegalDocumentBody.bodyAlign);
    }

    _mail ??= TapGestureRecognizer()
      ..onTap = () => launchUrl(Uri(scheme: 'mailto', path: kPrivacyEmail));
    return Text.rich(
      textAlign: LegalDocumentBody.bodyAlign,
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
            // The app's shared title bar (as on Settings and History) rather
            // than a hand-built copy of it.
            PageTitleBar(title: document.title),
            const Divider(height: 1, color: AppColors.borderNeutral),
            Expanded(
              child: SingleChildScrollView(
                // 24pt gutters, wider than the app's 16: a long-form reading
                // column wants a shorter measure, and justified lines show
                // their word gaps less the shorter they are.
                padding: EdgeInsets.fromLTRB(
                    24, 24, 24, MediaQuery.paddingOf(context).bottom + 48),
                child: LegalDocumentBody(document: document, showTitle: false),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
