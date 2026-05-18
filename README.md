# Monticello Villas — Resident Mobile App

Flutter frontend for the **Monticello Villas Cross-Platform Incident and Announcement Management System**. Built around a glassmorphic design language that communicates security, trust, and clarity.

## Design System

- **Palette:** deep navy primary, amber accent, teal/cyan status colors.
- **Typography:** Inter (via `google_fonts`) for a clean, modern feel.
- **Surfaces:** every card is a `GlassContainer` using `BackdropFilter` blur over a subtle gradient with a 1.2px white border.
- **Backgrounds:** `GradientScaffold` pairs a tri-stop navy gradient with soft ambient "orbs" behind the glass to add depth.
- **Components:** `PrimaryButton`, `GhostButton`, `SectionHeader`, `StatusChip`, `QuickActionTile`, `GlassTextField` — all tuned to the same aesthetic.

## Folder Structure

```
lib/
├── main.dart               # Routing + app entry
├── theme/
│   └── app_theme.dart      # Colors, spacing, radii, ThemeData
├── widgets/
│   ├── glass_container.dart
│   ├── gradient_scaffold.dart
│   └── shared_widgets.dart
├── models/
│   └── incident.dart       # Incident / Announcement models + mock data
└── screens/
    ├── splash_screen.dart
    ├── login_screen.dart            # Firebase Auth entry
    ├── verify_property_screen.dart  # Verify-First (Phase/Block/Lot)
    ├── home_screen.dart             # Dashboard + tabbed nav
    ├── report_incident_screen.dart  # Report with WPDA priority + watermark
    ├── announcements_screen.dart
    ├── panic_button_screen.dart     # Offline-capable emergency signal
    ├── map_screen.dart              # Leaflet-style subdivision map
    └── incidents_screen.dart        # Incident status tracker
```

## Running

```bash
flutter pub get
flutter run
```

## Feature Coverage

| Feature from thesis | Where |
|---|---|
| Firebase-authenticated sign-in | `login_screen.dart` |
| Verify-First Phase / Block / Lot registry | `verify_property_screen.dart` |
| Incident reporting with priority + forensic watermark | `report_incident_screen.dart` |
| Announcements with category filtering | `announcements_screen.dart` |
| Panic Button (offline / SMS fallback) | `panic_button_screen.dart` |
| Subdivision map with incident pins | `map_screen.dart` |
| Incident status tracking | `incidents_screen.dart` |
| Dashboard with WPDA-prioritised active incidents | `home_screen.dart` |
