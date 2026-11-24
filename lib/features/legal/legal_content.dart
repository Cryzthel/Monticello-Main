/// The app's legal documents, as structured content.
///
/// ONE COPY. The Terms and the Privacy Policy used to exist twice — a
/// six-section version in the Settings reader and a different five-section
/// version in the sign-up sheet — so the text a resident agreed to at
/// registration was not the text Settings later showed them. Both screens now
/// render these two constants through [LegalDocumentBody], and updating the
/// policy is an edit in this file only.
///
/// Text is the HOA's supplied copy (2026-10-18), verbatim.
library;

/// A paragraph, or a bulleted list, inside a section.
class LegalBlock {
  const LegalBlock.text(String this.text) : bullets = null;
  const LegalBlock.list(List<String> this.bullets) : text = null;

  final String? text;
  final List<String>? bullets;
}

class LegalSection {
  const LegalSection(this.heading, this.blocks);

  /// "1. Acceptance of Terms".
  final String heading;
  final List<LegalBlock> blocks;
}

class LegalDocument {
  const LegalDocument({
    required this.title,
    required this.sections,
    this.lastUpdated,
    this.intro,
  });

  final String title;
  final String? lastUpdated;
  final String? intro;
  final List<LegalSection> sections;
}

/// The address the Privacy Policy names for privacy requests. Rendered as a
/// tappable link wherever it appears.
const String kPrivacyEmail = 'adminmonticellov@gmail.com';

const LegalDocument termsAndConditions = LegalDocument(
  title: 'Terms and Conditions',
  lastUpdated: 'September 2, 2026',
  intro: 'Welcome to the Monticello Villas Incident & Announcement Management '
      'System. These Terms and Conditions explain the rules for using the '
      'Monticello Villas mobile application and its related services. By using '
      'the application, you agree to follow these terms. Please take a moment '
      'to read them carefully.',
  sections: [
    LegalSection('1. Acceptance of Terms', [
      LegalBlock.text(
          'By downloading, accessing, or using the Monticello Villas App, you '
          'agree to follow these Terms and Conditions. If you do not agree with '
          'any part of these terms, please do not install or use the '
          'application.'),
    ]),
    LegalSection('2. Eligibility and Account Verification', [
      LegalBlock.text(
          'The application is intended for verified residents of Monticello '
          'Villas. To use features such as incident reporting, emergency '
          'alerts, and community announcements, residents may be required to '
          'provide information and identification documents for verification. '
          'You are responsible for keeping your account information and login '
          'credentials secure. You are also responsible for any activity made '
          'using your account.'),
    ]),
    LegalSection('3. Proper Use of the Application and Incident Reporting', [
      LegalBlock.text(
          'When submitting an incident report or using the SOS emergency '
          'feature, you are expected to provide information that is truthful, '
          'accurate, and relevant to the situation.'),
      LegalBlock.text('The following activities are not allowed:'),
      LegalBlock.list([
        'Making false or misleading incident reports.',
        'Using the SOS button without a legitimate emergency.',
        'Uploading illegal, inappropriate, or unrelated photos or videos.',
        "Using another person's account without permission.",
        "Attempting to access, damage, or interfere with the application's "
            'systems or security.',
      ]),
      LegalBlock.text(
          'Misuse of the application may result in the suspension or removal '
          'of your account and may be subject to appropriate administrative or '
          'legal action.'),
    ]),
    LegalSection('4. Emergency Alerts and Internet Connectivity', [
      LegalBlock.text(
          'The application is designed to help residents report emergencies and '
          'communicate with security personnel. However, the availability and '
          'speed of these services may be affected by internet connection, '
          'mobile network coverage, device settings, or other technical issues. '
          'If an internet connection is not available, the application may '
          'provide an SMS fallback option. This feature prepares an emergency '
          "message using your device's messaging application. You are "
          'responsible for reviewing and manually sending the message through '
          'your mobile network provider. The application should not be '
          'considered a replacement for contacting appropriate emergency '
          'services when immediate assistance is required.'),
    ]),
    LegalSection('5. User Content and Uploaded Media', [
      LegalBlock.text(
          'When you submit incident reports, photographs, videos, descriptions, '
          'or other information through the application, you allow the '
          'Monticello Villas Homeowners Association to collect, store, review, '
          'and process this information for legitimate purposes related to '
          'security, incident response, investigation, and community '
          'administration. Your submitted information will only be handled by '
          'authorized personnel for purposes connected to the operation and '
          'safety of the subdivision.'),
    ]),
    LegalSection('6. Intellectual Property', [
      LegalBlock.text(
          "The application's design, layout, logos, branding, graphics, "
          'features, source code, and other related materials belong to '
          'Monticello Villas or its authorized licensors, unless otherwise '
          'stated. You may not copy, modify, distribute, reproduce, or use these '
          'materials without proper authorization.'),
    ]),
    LegalSection('7. Suspension or Termination', [
      LegalBlock.text(
          'Monticello Villas reserves the right to temporarily suspend or '
          'permanently remove access to the application if a user violates '
          "these Terms and Conditions, misuses the application's features, "
          'provides false information, or attempts to perform unauthorized '
          'activities. Access may also be restricted when necessary to protect '
          'the security and proper operation of the system.'),
    ]),
  ],
);

const LegalDocument privacyPolicy = LegalDocument(
  title: 'Privacy Policy',
  sections: [
    LegalSection('1. Information We Collect', [
      LegalBlock.text(
          'To provide resident verification, incident reporting, emergency '
          'response, and community communication services, the application may '
          'collect personal information, including your full name, email '
          'address, property or lot information, and HOA-issued identification '
          'submitted for resident verification. The application may also '
          'collect your GPS location when you pin an incident location, submit '
          'an incident report, or trigger an SOS emergency alert. This '
          'information helps identify where an incident occurred and enables '
          'authorized security personnel to respond appropriately to reported '
          'emergencies. In addition, when submitting an incident report, you '
          'may provide photos, videos, incident descriptions, and other relevant '
          'details to help security personnel and administrators understand, '
          'assess, and address the reported incident. The application may also '
          'store device and application-related information, such as network '
          'availability, locally stored offline reports or SOS information, and '
          'application preferences, to support its functionality and help '
          'maintain service continuity.'),
    ]),
    LegalSection('2. How We Use Your Information', [
      LegalBlock.text(
          'The information collected through the application is primarily used '
          'to support security, emergency response, resident verification, and '
          'community communication within Monticello Villas. This information '
          'helps verify authorized residents, manage resident and property '
          'access, and assist security personnel in locating and responding to '
          'active SOS emergency alerts. It is also used to process and '
          'investigate incident reports, send and display community '
          'announcements, provide relevant information for incident monitoring '
          'and management, and maintain the security, functionality, and proper '
          'operation of the application. All collected information is used only '
          'for legitimate purposes related to the operation and administration '
          'of the system, subject to applicable data protection laws and '
          'appropriate safeguards.'),
    ]),
    LegalSection('3. How Your Information Is Shared', [
      LegalBlock.text(
          'Your information is shared only when necessary to operate the '
          'incident reporting and emergency response system of Monticello '
          'Villas. Incident reports, location details, photographs, videos, and '
          'other relevant information may be accessed by authorized Homeowners '
          'Association (HOA) administrators and on-duty security personnel '
          'through the appropriate management and security systems to review '
          'reports, monitor incidents, and coordinate appropriate responses. The '
          'application may also use third-party services, such as Mapbox, to '
          'provide mapping and location visualization features, and these '
          'services may process relevant information in accordance with their '
          'respective privacy policies and applicable terms. The application '
          'does not sell, rent, or trade your personal information. However, '
          'information may be disclosed to government agencies, law enforcement '
          'authorities, or other authorized parties when required by law or '
          'when such disclosure is legally necessary, subject to applicable data '
          'protection requirements.'),
    ]),
    LegalSection('4. How We Protect Your Information', [
      LegalBlock.text(
          'We implement reasonable security measures to protect your personal '
          'information against unauthorized access, misuse, loss, alteration, '
          'or disclosure. Access to information stored in the system is '
          'restricted through appropriate security controls to ensure that only '
          'authorized users can access the information necessary to perform '
          'their responsibilities. Sensitive resident verification documents '
          'are accessible only to authorized personnel who require them for '
          'verification and administrative purposes. Information that must '
          'remain available when the device is offline, such as pending SOS '
          'emergency details, may be stored using secure local device storage '
          'to support emergency response and allow information to be '
          'synchronized when an internet connection becomes available. These '
          'measures are intended to maintain the confidentiality, integrity, and '
          'availability of collected information and to reduce the risk of '
          'unauthorized use or access.'),
    ]),
    LegalSection('5. Data Retention and Your Rights', [
      LegalBlock.text(
          'Personal information, incident reports, and resident verification '
          'documents are retained only for as long as reasonably necessary to '
          'fulfill legitimate administrative, security, emergency response, and '
          'record-keeping purposes, in accordance with applicable laws and '
          'regulations. Residents may request access to or correction of their '
          'personal information through the appropriate application settings '
          'or by contacting the Monticello Villas Homeowners Association (HOA) '
          'Administration. Subject to applicable laws, residents may also have '
          'the right to access their personal information, request corrections '
          'to inaccurate or incomplete data, object to certain types of data '
          'processing, request the deletion or removal of personal information '
          'when legally permitted, and file a complaint regarding the '
          'collection, use, storage, or handling of their personal information. '
          'All requests and rights are subject to the applicable provisions of '
          'the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) and '
          'other relevant regulations.'),
    ]),
    LegalSection('6. Contact Us', [
      LegalBlock.text(
          'If you have any questions, concerns, or requests regarding this '
          'Privacy Policy or the collection, use, storage, and protection of '
          'your personal information, you may contact the Monticello Villas '
          'Homeowners Association (HOA) Administration through the email '
          'address $kPrivacyEmail. Residents are encouraged to reach out to the '
          'HOA Administration for assistance with privacy-related concerns, '
          'requests to access or correct their personal information, or '
          'inquiries regarding how their information is handled through the '
          'application.'),
    ]),
  ],
);
