import 'package:flutter/material.dart';

enum IncidentPriority { low, medium, high, critical }

enum IncidentStatus { pending, verified, dispatched, inProgress, resolved }

class Incident {
  final String id;
  final String title;
  final String category;
  final String phase;
  final String block;
  final String lot;
  final String description;
  final DateTime reportedAt;
  final IncidentPriority priority;
  final IncidentStatus status;
  final String reporter;
  final bool hasMedia;

  const Incident({
    required this.id,
    required this.title,
    required this.category,
    required this.phase,
    required this.block,
    required this.lot,
    required this.description,
    required this.reportedAt,
    required this.priority,
    required this.status,
    required this.reporter,
    this.hasMedia = false,
  });

  String get location => 'Phase $phase • Block $block • Lot $lot';
}

class IncidentPriorityInfo {
  static Color color(IncidentPriority p) {
    switch (p) {
      case IncidentPriority.critical:
        return const Color(0xFFEF4444);
      case IncidentPriority.high:
        return const Color(0xFFF97316);
      case IncidentPriority.medium:
        return const Color(0xFFFBBF24);
      case IncidentPriority.low:
        return const Color(0xFF60A5FA);
    }
  }

  static String label(IncidentPriority p) {
    switch (p) {
      case IncidentPriority.critical:
        return 'Critical';
      case IncidentPriority.high:
        return 'High';
      case IncidentPriority.medium:
        return 'Medium';
      case IncidentPriority.low:
        return 'Low';
    }
  }
}

class IncidentStatusInfo {
  static Color color(IncidentStatus s) {
    switch (s) {
      case IncidentStatus.pending:
        return const Color(0xFFFBBF24);
      case IncidentStatus.verified:
        return const Color(0xFF60A5FA);
      case IncidentStatus.dispatched:
        return const Color(0xFFA78BFA);
      case IncidentStatus.inProgress:
        return const Color(0xFF22D3EE);
      case IncidentStatus.resolved:
        return const Color(0xFF2DD4BF);
    }
  }

  static String label(IncidentStatus s) {
    switch (s) {
      case IncidentStatus.pending:
        return 'Pending';
      case IncidentStatus.verified:
        return 'Verified';
      case IncidentStatus.dispatched:
        return 'Dispatched';
      case IncidentStatus.inProgress:
        return 'In Progress';
      case IncidentStatus.resolved:
        return 'Resolved';
    }
  }

  static IconData icon(IncidentStatus s) {
    switch (s) {
      case IncidentStatus.pending:
        return Icons.hourglass_empty;
      case IncidentStatus.verified:
        return Icons.verified_outlined;
      case IncidentStatus.dispatched:
        return Icons.send_outlined;
      case IncidentStatus.inProgress:
        return Icons.autorenew;
      case IncidentStatus.resolved:
        return Icons.check_circle_outline;
    }
  }
}

class Announcement {
  final String id;
  final String title;
  final String body;
  final DateTime postedAt;
  final String author;
  final bool pinned;
  final String category;

  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    required this.postedAt,
    required this.author,
    this.pinned = false,
    this.category = 'General',
  });
}

/// Mock data used for the UI preview.
class MockData {
  static final incidents = <Incident>[
    Incident(
      id: 'INC-0421',
      title: 'Suspicious vehicle near gate',
      category: 'Security',
      phase: '2',
      block: '14',
      lot: '07',
      description:
          'Unmarked van parked for over 40 minutes near the east gate entrance.',
      reportedAt: DateTime.now().subtract(const Duration(minutes: 15)),
      priority: IncidentPriority.high,
      status: IncidentStatus.dispatched,
      reporter: 'You',
      hasMedia: true,
    ),
    Incident(
      id: 'INC-0418',
      title: 'Streetlight not working',
      category: 'Maintenance',
      phase: '3',
      block: '8',
      lot: '22',
      description: 'Corner post lamp has been out since last night.',
      reportedAt: DateTime.now().subtract(const Duration(hours: 6)),
      priority: IncidentPriority.medium,
      status: IncidentStatus.inProgress,
      reporter: 'You',
    ),
    Incident(
      id: 'INC-0410',
      title: 'Noise complaint',
      category: 'Community',
      phase: '1',
      block: '3',
      lot: '14',
      description: 'Loud karaoke past quiet hours.',
      reportedAt: DateTime.now().subtract(const Duration(days: 2)),
      priority: IncidentPriority.low,
      status: IncidentStatus.resolved,
      reporter: 'You',
    ),
  ];

  static final announcements = <Announcement>[
    Announcement(
      id: 'ANN-012',
      title: 'Scheduled water interruption — April 18',
      body:
          'Maintenance crews will perform pipeline upgrades in Phase 2 and 3 from 8:00 AM to 2:00 PM.',
      postedAt: DateTime.now().subtract(const Duration(hours: 3)),
      author: 'HOA Admin',
      pinned: true,
      category: 'Utilities',
    ),
    Announcement(
      id: 'ANN-011',
      title: 'New security patrol schedule',
      body:
          'Effective this week, perimeter patrols will rotate every 45 minutes during night shifts.',
      postedAt: DateTime.now().subtract(const Duration(days: 1)),
      author: 'Security Office',
      category: 'Security',
    ),
    Announcement(
      id: 'ANN-010',
      title: 'Community clean-up drive',
      body:
          'Join us this Saturday for the monthly subdivision clean-up and tree-planting activity.',
      postedAt: DateTime.now().subtract(const Duration(days: 2)),
      author: 'HOA Admin',
      category: 'Events',
    ),
  ];
}
