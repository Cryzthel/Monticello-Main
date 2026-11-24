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
        fontSize: 14.5,
        color: AppColors.textSecondary,
        height: 1.6,
      );

  /// Every block of running text is justified, by request, so the two
  /// documents set as documents. Flutter leaves each paragraph's LAST line
  /// ragged, which is what keeps a short closing line from being stretched
  /// across the page. Headings stay left-aligned: they are labels, and
  /// justifying a one-line heading does nothing but space it out.
  /// Left-aligned, not justified (2026-10-29): in a card's narrower column,
  /// justification opens rivers of space between words.
  static const TextAlign bodyAlign = TextAlign.start;

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
          _IntroCard(text: doc.intro!, bodyStyle: _bodyStyle),
          const SizedBox(height: 16),
        ],
        // Each section in its own card (2026-10-29, by request), so a long
        // document reads as a set of short, separate topics.
        for (var i = 0; i < doc.sections.length; i++) ...[
          if (i > 0) const SizedBox(height: 12),
          _SectionCard(child: _Section(section: doc.sections[i], bodyStyle: _bodyStyle)),
        ],
      ],
    );
  }
}

/// The document's welcome, as the lead card (2026-10-30, by request): a
/// tinted panel with a shield mark and a short label over the intro (not the
/// title, which the page may already show), set apart
/// from the plain section cards that follow it.
class _IntroCard extends StatelessWidget {
  const _IntroCard({required this.text, required this.bodyStyle});

  final String text;
  final TextStyle bodyStyle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.accentPrimary.withValues(alpha: 0.10),
            AppColors.accentPrimary.withValues(alpha: 0.03),
          ],
        ),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.accentPrimary.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: AppColors.primaryDark,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.verified_user_rounded, size: 18, color: Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Please read carefully',
                  style: sfPro(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(text, style: bodyStyle.copyWith(color: AppColors.textPrimary), textAlign: LegalDocumentBody.bodyAlign),
        ],
      ),
    );
  }
}

/// The card each section sits in: white, a neutral hairline, the app's card
/// radius.
class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.borderNeutral),
      ),
      child: child,
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
                // The app's 16pt gutters: the cards inside add their own
                // padding, which keeps the reading measure short.
                padding: EdgeInsets.fromLTRB(
                    16, 20, 16, MediaQuery.paddingOf(context).bottom + 48),
                child: LegalDocumentBody(document: document, showTitle: false),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
