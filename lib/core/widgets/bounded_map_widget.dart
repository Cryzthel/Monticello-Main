import 'package:flutter/material.dart';

import 'package:monticello_villas_app/core/theme/app_theme.dart';

/// A hard layout boundary around a map.
///
/// Maps are the single most dangerous widget to drop into a dashboard column.
/// Every map implementation in this app (`flutter_map`'s [FlutterMap],
/// `mapbox_maps_flutter`'s `MapWidget`) wants to fill whatever space it is
/// given, and both misbehave when handed an *unbounded* constraint — which is
/// exactly what a `Column`, `ListView` or `SingleChildScrollView` hands its
/// children on the main axis. The failure is not a clean exception either: the
/// subtree can collapse to near-zero height, leaving the scaffold's background
/// colour filling the screen with the rest of the content squeezed into a
/// sliver. That is precisely the "solid background, tiny container" signature.
///
/// This widget makes that impossible by construction:
///
///  * [height] is applied via [SizedBox], so the child always receives a
///    tight, finite vertical constraint no matter what the parent passes down.
///  * [ClipRRect] stops the map painting outside its box even if the platform
///    view overdraws.
///  * The child is built inside a [Builder] guarded by [_MapErrorBoundary], so
///    a map that throws during build degrades to a labelled placeholder
///    instead of taking the entire dashboard down with it.
///
/// Use this for any map EMBEDDED in a scrolling dashboard. A full-screen map
/// route doesn't need it — there the map is the whole viewport and bounds come
/// from the scaffold.
/// What shows for the instant before the first map tiles paint, and behind the
/// header's rounded corners, on a full-bleed map.
///
/// Slate-800 rather than white or the app's accent: it has to read as "imagery
/// loading" from a cold start and as a neutral ground behind a saturated green
/// header at the same time. White failed both.
const Color _backdropFill = Color(0xFF1E293B); // slate-800

class BoundedMapWidget extends StatelessWidget {
  const BoundedMapWidget({
    super.key,
    required this.child,
    this.height = 260,
    this.borderRadius = AppRadius.lg,
    this.margin = EdgeInsets.zero,
    this.showBorder = true,
    this.shadows,
    this.overlay,
    this.placeholderLabel = 'Map unavailable',
  });

  /// The map itself. Built lazily so a construction failure is caught.
  final Widget child;

  /// Fixed height. Required conceptually — a "bounded" map with a null height
  /// would defeat the entire purpose of this widget.
  final double height;

  final double borderRadius;
  final EdgeInsetsGeometry margin;
  final bool showBorder;

  /// Optional elevation cast by the card. Off by default so the maps already
  /// embedded in flat surfaces are untouched — a shadow is opted into by the
  /// caller that wants the card to lift off the page.
  final List<BoxShadow>? shadows;

  /// Optional controls/badges stacked above the map, inside the same clip.
  final Widget? overlay;

  final String placeholderLabel;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(borderRadius);
    // A full-bleed map (borderRadius 0) is the dashboard backdrop; anything
    // else is a card. The two want different treatment on both counts below.
    final isCard = borderRadius > 0;

    final content = _MapErrorBoundary(
      label: placeholderLabel,
      child: overlay == null
          ? child
          : Stack(
              fit: StackFit.expand,
              children: [child, overlay!],
            ),
    );

    return Padding(
      padding: margin,
      child: SizedBox(
        // Tight height, unbounded-safe. This is the load-bearing line.
        height: height,
        width: double.infinity,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: radius,
            border: showBorder
                ? Border.all(color: AppColors.glassBorderLight)
                : null,
            boxShadow: shadows,
            // ── WHY THIS IS NOT WHITE WHEN FULL-BLEED ────────────────────
            //
            // Painted behind the map so the box still reads as a surface while
            // tiles load. As a CARD, white is right — it matches every other
            // card on the page.
            //
            // As the dashboard BACKDROP it was the source of the white bleed:
            // it showed through the green header's rounded bottom corners, and
            // flashed full-screen white for the moment before the first tiles
            // painted. A dark slate reads as "map that has not drawn yet"
            // instead of "broken white page", and it is what the eye expects
            // under imagery.
            color: isCard ? AppColors.backgroundSecondary : _backdropFill,
          ),
          // ── NO CLIP WHEN THERE IS NOTHING TO CLIP ──────────────────────
          //
          // This is the map-performance fix, not a tidy-up. `child` is a native
          // platform view; wrapping one in a ClipRRect forces Flutter onto the
          // hybrid-composition path on Android, where every frame of the map
          // round-trips through a texture instead of being composited by the
          // system directly. That is precisely the "sticky pan, sluggish
          // pinch-zoom" symptom — the gestures were always configured
          // correctly, they were just being rendered through an extra copy.
          //
          // At radius 0 the clip was doing nothing visible and costing that on
          // every frame. Cards keep theirs: a rounded corner genuinely needs
          // it, and a 260px card is a fraction of the fill cost of a
          // full-screen one.
          child: isCard ? ClipRRect(borderRadius: radius, child: content) : content,
        ),
      ),
    );
  }
}

/// Catches a build-time failure in the map subtree.
///
/// Flutter has no try/catch for widget building, so this swaps in Flutter's
/// own error-reporting hook for the duration of this subtree: if the child
/// throws, [ErrorWidget.builder] produces our placeholder instead of the
/// default red screen (debug) or grey box (release), and the surrounding
/// dashboard keeps rendering normally.
class _MapErrorBoundary extends StatelessWidget {
  const _MapErrorBoundary({required this.child, required this.label});

  final Widget child;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Builder(
      builder: (context) {
        final previous = ErrorWidget.builder;
        ErrorWidget.builder = (details) => _MapPlaceholder(label: label);
        // Restored on the next frame so this override can never leak out and
        // swallow unrelated errors elsewhere in the app.
        WidgetsBinding.instance.addPostFrameCallback((_) {
          ErrorWidget.builder = previous;
        });
        return child;
      },
    );
  }
}

class _MapPlaceholder extends StatelessWidget {
  const _MapPlaceholder({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.backgroundSecondary,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.map_outlined, color: AppColors.textMuted, size: 26),
            const SizedBox(height: 8),
            Text(
              label,
              textAlign: TextAlign.center,
              style: sfPro(fontSize: 12.5, color: AppColors.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}
