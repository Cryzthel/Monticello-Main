import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:video_player/video_player.dart';

import 'package:monticello_villas_app/core/widgets/modern_close_button.dart';
import 'package:monticello_villas_app/features/incidents/models/incident.dart';
import 'package:monticello_villas_app/core/storage/local_data_store.dart';
import 'package:monticello_villas_app/core/theme/app_theme.dart';
import 'package:monticello_villas_app/core/widgets/leaf_loader.dart';

// ═══════════════════════════════════════════════════════════════════════════
// Evidence media viewer
//
// Renders a report's photo & video evidence (from Cloud Storage download URLs):
//   • photos as a thumbnail grid → tap opens a full-screen, zoomable gallery
//   • videos as rows → tap opens a full-screen player (video_player)
// ═══════════════════════════════════════════════════════════════════════════

class EvidenceSection extends StatelessWidget {
  const EvidenceSection({super.key, required this.incident});

  final Incident incident;

  @override
  Widget build(BuildContext context) {
    // Stay live: when the background upload finishes and the report doc gains
    // its photo/video URLs, this rebuilds and swaps the placeholder for the
    // real thumbnails automatically — the user never has to reopen the sheet.
    return ListenableBuilder(
      listenable: LocalDataStore.instance,
      builder: (context, _) {
        final inc = LocalDataStore.instance.incidents.firstWhere(
          (i) => i.id == incident.id,
          orElse: () => incident,
        );
        return _buildContent(context, inc);
      },
    );
  }

  Widget _buildContent(BuildContext context, Incident inc) {
    final photos = inc.photoUrls;
    final videos = inc.videoUrls;

    // Media was attached but the URLs aren't written yet (uploads finish in the
    // background). Show a calm, self-resolving placeholder — and after a bounded
    // wait, a clear "couldn't upload" state instead of an endless spinner.
    if (photos.isEmpty && videos.isEmpty) {
      if (!inc.hasMedia) return const SizedBox.shrink();
      final stalled = DateTime.now().difference(inc.reportedAt) >
          const Duration(minutes: 3);
      return _wrap(child: stalled ? _failedNotice() : _processingNotice());
    }

    return _wrap(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(PhosphorIconsFill.imagesSquare,
                  size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              Text('Evidence',
                  style: sfPro(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onGlassPrimary)),
              const Spacer(),
              Text(
                '${photos.length} photo${photos.length == 1 ? '' : 's'}'
                '${videos.isEmpty ? '' : ' · ${videos.length} video${videos.length == 1 ? '' : 's'}'}',
                style: sfPro(fontSize: 11.5, color: AppColors.onGlassMuted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _EvidenceGrid(photos: photos, videos: videos),
        ],
      ),
    );
  }

  // Calm "it'll appear automatically" placeholder (not a blocking loader).
  Widget _processingNotice() => Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.glassFillStrong,
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Icon(PhosphorIconsFill.cloudArrowUp,
                size: 19, color: AppColors.primaryDark),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Processing evidence…',
                    style: sfPro(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.onGlassPrimary)),
                const SizedBox(height: 2),
                Text(
                  'Your photos and videos will appear here automatically once '
                  'the upload finishes.',
                  style: sfPro(
                      fontSize: 11.5,
                      color: AppColors.onGlassMuted,
                      height: 1.35),
                ),
              ],
            ),
          ),
        ],
      );

  // Bounded failure state — shown once the upload has clearly not completed.
  Widget _failedNotice() => Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(11),
            ),
            child: const Icon(PhosphorIconsFill.cloudX,
                size: 19, color: AppColors.warning),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Evidence not available',
                    style: sfPro(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.onGlassPrimary)),
                const SizedBox(height: 2),
                Text(
                  'The upload didn\'t finish — check your connection, or file '
                  'the report again to re-attach the media.',
                  style: sfPro(
                      fontSize: 11.5,
                      color: AppColors.onGlassSecondary,
                      height: 1.35),
                ),
              ],
            ),
          ),
        ],
      );

  /// The evidence container.
  ///
  /// White fill and a slate-100 hairline, the same as the Report Summary card
  /// below it and the History cards the sheet opens from. It used to be
  /// [AppColors.glassFill] (white at 70%) inside [AppColors.glassBorderLight]
  /// (emerald-100 at 80%) — glass tokens, left over from when this sheet was a
  /// dark blurred panel. On the white sheet it became the one card in the
  /// stack with a green edge and a translucent fill, so the two containers in
  /// this sheet disagreed about what a card looks like.
  Widget _wrap({required Widget child}) => Container(
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
        child: child,
      );
}

/// One attachment in the evidence grid.
class _EvidenceItem {
  const _EvidenceItem({
    required this.url,
    required this.indexInType,
    required this.isVideo,
  });

  final String url;

  /// Position within its OWN list. The photo viewer is opened on the photo
  /// list, so a tile needs to know where it sits among photos, not among
  /// attachments in general.
  final int indexInType;

  final bool isVideo;
}

/// ─────────────────────── EVIDENCE GRID ───────────────────────
/// Every attachment on a report, photos and videos together, as one grid of
/// square thumbnails.
///
/// ── WHY ONE GRID AND NOT TWO LISTS ────────────────────────────────────────
/// Photos were a 3-across grid and videos were full-width rows underneath,
/// each with a 40px play square and the caption "Video 1". Two layouts for one
/// idea: the attachments a resident put on this report. A report with two
/// photos and two videos rendered as a small grid, then a pair of list rows
/// nothing about the grid predicted — three different tile shapes and two
/// different alignments inside a 16px card.
///
/// Now every attachment is the same 1:1 tile on the same 3-column grid with
/// the same corner radius, and the only thing that varies is what is inside
/// it: imagery for a photo, a play badge on a neutral field for a video. The
/// grid reads as a contact sheet, which is what it is.
///
/// ── OVERFLOW ──────────────────────────────────────────────────────────────
/// Attachments are capped by SIZE, not by count — see the report wizard's
/// `_maxPhotoBytes` — so a report can carry more tiles than a sheet should
/// open with. Past [_collapsedCount] the last visible tile becomes a `+N`
/// badge that expands the grid IN PLACE. It deliberately does not open a
/// viewer: the overflow can be photos or videos or both, and a tile that opens
/// "whichever type happens to sit at index six" is a tile whose behaviour
/// cannot be predicted from looking at it.
class _EvidenceGrid extends StatefulWidget {
  const _EvidenceGrid({required this.photos, required this.videos});

  final List<String> photos;
  final List<String> videos;

  /// Two full rows.
  static const int _collapsedCount = 6;
  static const int _columns = 3;
  static const double _gutter = 8;

  @override
  State<_EvidenceGrid> createState() => _EvidenceGridState();
}

class _EvidenceGridState extends State<_EvidenceGrid> {
  bool _expanded = false;

  List<_EvidenceItem> get _items => [
        for (var i = 0; i < widget.photos.length; i++)
          _EvidenceItem(
              url: widget.photos[i], indexInType: i, isVideo: false),
        for (var i = 0; i < widget.videos.length; i++)
          _EvidenceItem(
              url: widget.videos[i], indexInType: i, isVideo: true),
      ];

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final hidden = _expanded || items.length <= _EvidenceGrid._collapsedCount
        ? 0
        // The badge tile covers its own attachment as well as the ones past
        // it, so it counts itself.
        : items.length - _EvidenceGrid._collapsedCount + 1;
    final visible =
        hidden > 0 ? items.take(_EvidenceGrid._collapsedCount).toList() : items;

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: _EvidenceGrid._columns,
        crossAxisSpacing: _EvidenceGrid._gutter,
        mainAxisSpacing: _EvidenceGrid._gutter,
        // Square, for photos and videos alike. A mixed grid only reads as a
        // grid if every cell is the same shape.
        childAspectRatio: 1,
      ),
      itemCount: visible.length,
      itemBuilder: (context, i) {
        final item = visible[i];
        final isBadge = hidden > 0 && i == visible.length - 1;
        return ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: GestureDetector(
            onTap: isBadge
                ? () => setState(() => _expanded = true)
                : () => _open(context, item),
            child: Stack(
              fit: StackFit.expand,
              children: [
                _thumb(item),
                if (item.isVideo && !isBadge) const _PlayOverlay(),
                if (isBadge) _MoreOverlay(count: hidden),
              ],
            ),
          ),
        );
      },
    );
  }

  void _open(BuildContext context, _EvidenceItem item) {
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => item.isVideo
            ? _VideoPlayerScreen(url: item.url)
            : _PhotoGalleryScreen(
                urls: widget.photos, initialIndex: item.indexInType),
      ),
    );
  }

  Widget _thumb(_EvidenceItem item) {
    if (item.isVideo) {
      // Kick off buffering as soon as the tile is visible — by the time a
      // resident actually taps to play, the network + codec setup that used to
      // happen only after the tap has often already finished in the background.
      _VideoPreloadCache.instance.preload(item.url);
      // No frame is extracted for a poster image: `video_player` cannot hand
      // one over without spinning up a controller per tile, which is four
      // decoders inside a bottom sheet. A flat field under the play badge is
      // the honest version of "we do not have a thumbnail for this".
      return const ColoredBox(color: AppColors.neutralFill);
    }
    // Disk-cached (not just in-memory) so re-opening the same report's
    // evidence — or scrolling this grid back into view — is instant on the
    // second load instead of re-fetching from Cloud Storage every time.
    // Decoded at roughly the tile's actual on-screen size rather than full
    // resolution, so the grid paints faster too.
    return CachedNetworkImage(
      imageUrl: item.url,
      fit: BoxFit.cover,
      memCacheWidth: 240,
      placeholder: (context, _) => const _ThumbPlaceholder(),
      errorWidget: (_, __, ___) => const _ThumbPlaceholder(error: true),
    );
  }
}

/// The play badge on a video tile. A filled disc rather than a bare glyph, so
/// it stays legible whatever ends up behind it.
class _PlayOverlay extends StatelessWidget {
  const _PlayOverlay();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 34,
        height: 34,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: AppColors.textPrimary.withValues(alpha: 0.55),
        ),
        child: const Icon(PhosphorIconsFill.play, size: 16, color: Colors.white),
      ),
    );
  }
}

/// The `+N` tile: a scrim over the attachment it is standing in front of, so
/// the count reads as "and more of these" rather than as an empty slot.
class _MoreOverlay extends StatelessWidget {
  const _MoreOverlay({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.textPrimary.withValues(alpha: 0.62),
      child: Center(
        child: Text(
          '+$count',
          style: sfPro(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
      ),
    );
  }
}

/// Shown while a thumbnail loads, and in place of one that will not.
class _ThumbPlaceholder extends StatelessWidget {
  const _ThumbPlaceholder({this.error = false});

  final bool error;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.neutralFill,
      child: Icon(
        error ? PhosphorIconsFill.imageBroken : PhosphorIconsFill.image,
        color: AppColors.onGlassMuted,
        size: 20,
      ),
    );
  }
}


// ── Full-screen, zoomable photo gallery ─────────────────────────────────────
/// Opens the full-screen, pinch-zoomable photo gallery.
///
/// The gallery screen itself stays private; this is the seam other features
/// open it through. Announcement attachments and incident evidence are
/// different content but the same viewing job, and a second gallery built
/// beside this one would drift on gesture handling and caching within a
/// release or two.
void openPhotoGallery(
  BuildContext context,
  List<String> urls, {
  int initialIndex = 0,
}) {
  if (urls.isEmpty) return;
  Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _PhotoGalleryScreen(
        urls: urls,
        initialIndex: initialIndex.clamp(0, urls.length - 1),
      ),
    ),
  );
}

class _PhotoGalleryScreen extends StatefulWidget {
  const _PhotoGalleryScreen({required this.urls, required this.initialIndex});

  final List<String> urls;
  final int initialIndex;

  @override
  State<_PhotoGalleryScreen> createState() => _PhotoGalleryScreenState();
}

class _PhotoGalleryScreenState extends State<_PhotoGalleryScreen> {
  late final PageController _pageController =
      PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Text('${_index + 1} / ${widget.urls.length}',
            style: sfPro(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: Colors.white)),
        // TOP-RIGHT, not the AppBar's `leading` slot.
        //
        // This sat on the left, which is where every other screen in the app
        // puts BACK. Two different actions in the same corner is the kind of
        // thing a user only gets wrong once per session and resents each time.
        // `onDark` because a slate-100 disc disappears over a photograph.
        automaticallyImplyLeading: false,
        actions: const [
          ModernCloseButton(onDark: true, semanticLabel: 'Close photo'),
          SizedBox(width: 8),
        ],
      ),
      body: PageView.builder(
        controller: _pageController,
        onPageChanged: (i) => setState(() => _index = i),
        itemCount: widget.urls.length,
        itemBuilder: (_, i) => InteractiveViewer(
          minScale: 1,
          maxScale: 4,
          child: Center(
            // Same disk cache as the thumbnail grid — if the resident
            // already scrolled past this photo's thumbnail, the full-res
            // view still benefits from a warm cache for the base image
            // data rather than starting the download over.
            child: CachedNetworkImage(
              imageUrl: widget.urls[i],
              fit: BoxFit.contain,
              placeholder: (context, _) =>
                  const Center(child: LeafLoader(size: 40, color: Colors.white)),
              errorWidget: (_, __, ___) => const Center(
                child: Icon(PhosphorIconsFill.imageBroken,
                    color: Colors.white54, size: 48),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Small LRU cache of video controllers that are already `.initialize()`-ing
/// (or finished), keyed by URL. Evidence videos are usually tapped moments
/// after the incident timeline sheet opens, so [EvidenceSection] starts
/// buffering each video as soon as its row is visible — [_VideoPlayerScreen]
/// then reuses that same controller/future instead of starting a cold
/// network + codec setup from zero when the resident actually taps play.
/// Bounded at a handful of entries so a report with many videos can't hold
/// an unbounded number of open network connections.
class _VideoPreloadCache {
  _VideoPreloadCache._();
  static final instance = _VideoPreloadCache._();

  static const _maxEntries = 3;
  final _entries = <String, (VideoPlayerController, Future<void>)>{};

  /// Starts buffering [url] in the background if it isn't already cached.
  void preload(String url) {
    if (_entries.containsKey(url)) return;
    if (_entries.length >= _maxEntries) {
      final oldestKey = _entries.keys.first;
      _entries.remove(oldestKey)?.$1.dispose();
    }
    _entries[url] = _create(url);
  }

  /// Hands ownership of the controller for [url] to the caller — creating
  /// one fresh if it wasn't already preloading. The caller becomes
  /// responsible for disposing it.
  (VideoPlayerController, Future<void>) take(String url) {
    return _entries.remove(url) ?? _create(url);
  }

  (VideoPlayerController, Future<void>) _create(String url) {
    final controller = VideoPlayerController.networkUrl(Uri.parse(url));
    return (controller, controller.initialize());
  }
}

// ── Full-screen video player ────────────────────────────────────────────────
class _VideoPlayerScreen extends StatefulWidget {
  const _VideoPlayerScreen({required this.url});

  final String url;

  @override
  State<_VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<_VideoPlayerScreen> {
  late final VideoPlayerController _controller;
  bool _ready = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final (controller, initFuture) =
        _VideoPreloadCache.instance.take(widget.url);
    _controller = controller;
    initFuture.then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      _controller
        ..setLooping(true)
        ..play();
    }).catchError((_) {
      if (mounted) setState(() => _failed = true);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Text('Video evidence',
            style: sfPro(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: Colors.white)),
        // Top-right and `onDark`, matching the photo viewer above.
        automaticallyImplyLeading: false,
        actions: const [
          ModernCloseButton(onDark: true, semanticLabel: 'Close video'),
          SizedBox(width: 8),
        ],
      ),
      body: Center(
        child: _failed
            ? const _VideoError()
            : !_ready
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const LeafLoader(size: 40, color: AppColors.primary),
                      const SizedBox(height: 14),
                      Text('Buffering video…',
                          style: sfPro(fontSize: 13, color: Colors.white70)),
                    ],
                  )
                : GestureDetector(
                    onTap: () => setState(() {
                      _controller.value.isPlaying
                          ? _controller.pause()
                          : _controller.play();
                    }),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        AspectRatio(
                          aspectRatio: _controller.value.aspectRatio,
                          child: VideoPlayer(_controller),
                        ),
                        // Live buffering indicator — the controller tracks
                        // its own buffered range against the network's
                        // actual throughput, so this reacts in real time
                        // to a slow connection mid-playback (a rebuffer
                        // stall) rather than only at initial load.
                        ValueListenableBuilder<VideoPlayerValue>(
                          valueListenable: _controller,
                          builder: (_, value, __) => AnimatedOpacity(
                            opacity: value.isBuffering ? 1 : 0,
                            duration: const Duration(milliseconds: 150),
                            child: const SizedBox(
                              width: 36,
                              height: 36,
                              child:
                                  LeafLoader(size: 36, color: AppColors.primary),
                            ),
                          ),
                        ),
                        // Play/pause overlay icon.
                        ValueListenableBuilder<VideoPlayerValue>(
                          valueListenable: _controller,
                          builder: (_, value, __) => AnimatedOpacity(
                            opacity:
                                value.isPlaying || value.isBuffering ? 0 : 1,
                            duration: const Duration(milliseconds: 200),
                            child: Container(
                              width: 64,
                              height: 64,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: Colors.black.withValues(alpha: 0.45),
                              ),
                              child: const Icon(PhosphorIconsFill.play,
                                  color: Colors.white, size: 40),
                            ),
                          ),
                        ),
                        // Scrubber at the bottom.
                        Positioned(
                          left: 0,
                          right: 0,
                          bottom: 0,
                          child: VideoProgressIndicator(
                            _controller,
                            allowScrubbing: true,
                            colors: const VideoProgressColors(
                              playedColor: AppColors.primary,
                              bufferedColor: Colors.white30,
                              backgroundColor: Colors.white10,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
      ),
    );
  }
}

class _VideoError extends StatelessWidget {
  const _VideoError();

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(PhosphorIconsFill.warningCircle, color: Colors.white54, size: 44),
        const SizedBox(height: 12),
        Text('Could not play this video.',
            style: sfPro(fontSize: 14, color: Colors.white70)),
      ],
    );
  }
}
