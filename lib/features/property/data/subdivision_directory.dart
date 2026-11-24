import 'package:monticello_villas_app/core/config/map_constants.dart';

/// One addressable lot in Monticello Villas.
///
/// Value type with structural equality so a selected address can be compared
/// against a stored recent entry without holding on to object identity.
class SubdivisionAddress {
  const SubdivisionAddress({
    required this.phase,
    required this.block,
    required this.lot,
  });

  final String phase;
  final int block;
  final int lot;

  /// The ONE place the address wording is defined.
  ///
  /// Everything that shows an address — the search rows, the recent list, the
  /// map badge, the composed incident record — renders through this, so the
  /// dispatcher never sees the same lot written two ways.
  String get label => 'Phase $phase, Block $block, Lot $lot';

  /// The estate's own shorthand for the phase: MV1, MV2, MV3, MV5.
  ///
  /// Matches the site-plan sheet names, which is what the HOA office and the
  /// developer's drawings both use.
  String get planCode => 'MV$phase';

  /// The second line under [label], everywhere an address is shown.
  String get subtitle => 'Monticello Villas ($planCode)';

  /// Compact form for anywhere a single line has to carry the whole address.
  String get compactLabel => 'Ph $phase · Blk $block · Lot $lot';

  /// `Blk 5 Lot 19` — the map's floating lot tags.
  ///
  /// No phase, because every tag on screen is in the phase the pin is already
  /// standing in, and repeating it on each one costs the width that keeps the
  /// tags from colliding.
  String get shortLabel => 'Blk $block Lot $lot';

  /// Round-trips through [parse]. Deliberately not [label] — a stored string
  /// that has to be re-parsed with a regex is a format that cannot be changed
  /// without migrating everything anyone ever saved.
  String get storageKey => '$phase/$block/$lot';

  static SubdivisionAddress? parse(String raw) {
    final parts = raw.split('/');
    if (parts.length != 3) return null;
    final block = int.tryParse(parts[1]);
    final lot = int.tryParse(parts[2]);
    if (block == null || lot == null || parts[0].isEmpty) return null;
    return SubdivisionAddress(phase: parts[0], block: block, lot: lot);
  }

  @override
  bool operator ==(Object other) =>
      other is SubdivisionAddress &&
      other.phase == phase &&
      other.block == block &&
      other.lot == lot;

  @override
  int get hashCode => Object.hash(phase, block, lot);

  @override
  String toString() => label;
}

/// An unbroken run of lot numbers, inclusive at both ends.
///
/// A single lot is `LotRun(14, 14)`.
class LotRun {
  const LotRun(this.first, this.last);

  final int first;
  final int last;

  int get count => last - first + 1;

  bool contains(int lot) => lot >= first && lot <= last;

  /// "5-30", or "14" when the run is one lot.
  String get label => first == last ? '$first' : '$first-$last';
}

/// The lot numbers a single block actually contains.
///
/// ── WHY A LIST OF RUNS AND NOT A FIRST/LAST PAIR ────────────────────────────
/// The estate's numbering has holes in it. Phase 2's Block 11 is
/// `1, 4-7, 10-11, 13-19, 21-25, 27-28, 30-44, 46-50, 52-56` — fifty-six lot
/// numbers of which only forty-six exist. A first/last pair would have to say
/// 1-56 and would hand a guard ten addresses that are open space, a clubhouse
/// easement or a road.
///
/// This also outgrew the earlier single-range model, which was already there to
/// handle Phase 1's Block 3 starting at Lot 25 rather than Lot 1. Same reason,
/// one level further: store what the survey says, never a rule that happens to
/// fit it.
class BlockSpec {
  const BlockSpec(this.block, this.runs);

  final int block;
  final List<LotRun> runs;

  int get lotCount {
    var total = 0;
    for (final run in runs) {
      total += run.count;
    }
    return total;
  }

  bool contains(int lot) => runs.any((r) => r.contains(lot));

  int get firstLot => runs.first.first;
  int get lastLot => runs.last.last;

  /// True when the block's numbering has a gap in it — i.e. `lastLot` overstates
  /// how many lots there are.
  bool get hasGaps => runs.length > 1;

  /// "1-3, 5-30", exactly as the schedule reads.
  String get lotSummary => runs.map((r) => r.label).join(', ');
}

/// The structured Phase / Block / Lot directory the location search reads.
///
/// ── PROVENANCE ─────────────────────────────────────────────────────────────
/// Phases 1, 2, 3 and 5, as supplied by the estate from the Pro-Friends site
/// plans (sheets MV1, MV2, MV3, MV5). 1,444 addressable lots. This is the whole
/// estate — [phasesAwaitingData] is now empty, and the search's "still being
/// added" notice no longer appears.
///
/// It replaced a generated `for block in 1..8 / for lot in 1..24` grid: 768
/// addresses, almost none of them real.
///
/// ── WHERE THE SPEC AND THE SCHEDULE DISAGREE, THE SCHEDULE WINS ─────────────
/// The brief describing this data also summarised each phase in prose, and two
/// of those summaries do not match the lot schedule they accompanied:
///
///   • Phase 2 — prose said "upper block developments (Blocks 17-22)". The
///     schedule lists Blocks 1-20. Encoded as 1-20.
///   • Phase 5 — prose said "Blocks 1 through 7". The schedule lists Blocks 1-5.
///     Encoded as 1-5.
///
/// (Phase 1's "Blocks 2 through 13" and Phase 3's "Blocks 1 through 10" both
/// agree with their schedules.) The per-lot schedule is the more specific
/// document and the one a dispatcher's address has to match, so it is the one
/// encoded here. If the prose was right, the missing blocks are a data-entry
/// job in this file and nothing else changes.
///
/// To revise a phase: edit its `BlockSpec` list. The flat address list, the
/// search, the counts and every label derive from it.
class SubdivisionDirectory {
  SubdivisionDirectory._();

  /// Phase 1 — Isabella units. Site plan MV1.
  ///
  /// There is no Block 1, and Block 3 starts at Lot 25. Both are faithful to the
  /// schedule supplied; neither is a typo to be "corrected".
  static const List<BlockSpec> _phase1 = [
    BlockSpec(2, [LotRun(1, 66)]),
    BlockSpec(3, [LotRun(25, 60)]),
    BlockSpec(4, [LotRun(1, 50)]),
    BlockSpec(5, [LotRun(1, 39)]),
    BlockSpec(6, [LotRun(1, 35)]),
    BlockSpec(7, [LotRun(1, 33)]),
    BlockSpec(8, [LotRun(1, 30)]),
    BlockSpec(9, [LotRun(1, 30)]),
    BlockSpec(10, [LotRun(1, 32)]),
    BlockSpec(11, [LotRun(1, 32)]),
    BlockSpec(12, [LotRun(1, 34)]),
    BlockSpec(13, [LotRun(1, 40)]),
  ];

  /// Phase 2 — Florence and Isabella units. Site plan MV2.
  static const List<BlockSpec> _phase2 = [
    BlockSpec(1, [LotRun(1, 3), LotRun(5, 30)]),
    BlockSpec(2, [LotRun(1, 28)]),
    BlockSpec(3, [LotRun(1, 1), LotRun(3, 28)]),
    BlockSpec(4, [LotRun(1, 4), LotRun(6, 28)]),
    BlockSpec(5, [LotRun(1, 28)]),
    BlockSpec(6, [
      LotRun(1, 3),
      LotRun(5, 6),
      LotRun(8, 16),
      LotRun(18, 35),
      LotRun(37, 38),
    ]),
    BlockSpec(7, [LotRun(1, 38)]),
    BlockSpec(8, [
      LotRun(1, 2),
      LotRun(4, 9),
      LotRun(11, 13),
      LotRun(15, 16),
      LotRun(18, 27),
      LotRun(29, 30),
      LotRun(32, 36),
    ]),
    BlockSpec(9, [
      LotRun(1, 9),
      LotRun(11, 23),
      LotRun(25, 27),
      LotRun(29, 36),
    ]),
    BlockSpec(10, [LotRun(1, 28), LotRun(30, 32), LotRun(34, 44)]),
    BlockSpec(11, [
      LotRun(1, 1),
      LotRun(4, 7),
      LotRun(10, 11),
      LotRun(13, 19),
      LotRun(21, 25),
      LotRun(27, 28),
      LotRun(30, 44),
      LotRun(46, 50),
      LotRun(52, 56),
    ]),
    BlockSpec(12, [LotRun(1, 7), LotRun(9, 20)]),
    BlockSpec(13, [LotRun(1, 2), LotRun(4, 24), LotRun(26, 30)]),
    BlockSpec(14, [
      LotRun(1, 11),
      LotRun(15, 15),
      LotRun(17, 19),
      LotRun(21, 21),
      LotRun(23, 28),
    ]),
    BlockSpec(15, [
      LotRun(1, 3),
      LotRun(5, 7),
      LotRun(9, 16),
      LotRun(18, 25),
    ]),
    BlockSpec(16, [LotRun(1, 5), LotRun(7, 14), LotRun(16, 22)]),
    BlockSpec(17, [
      LotRun(1, 4),
      LotRun(6, 12),
      LotRun(14, 14),
      LotRun(16, 16),
      LotRun(19, 20),
    ]),
    BlockSpec(18, [
      LotRun(2, 5),
      LotRun(7, 9),
      LotRun(11, 13),
      LotRun(17, 20),
    ]),
    BlockSpec(19, [LotRun(1, 2), LotRun(4, 11), LotRun(13, 18)]),
    BlockSpec(20, [LotRun(1, 23)]),
  ];

  /// Phase 3 — Daniella units, along the main access road. Site plan MV3.
  static const List<BlockSpec> _phase3 = [
    BlockSpec(1, [
      LotRun(1, 3),
      LotRun(5, 9),
      LotRun(11, 38),
      LotRun(40, 111),
    ]),
    BlockSpec(2, [LotRun(1, 26), LotRun(28, 58)]),
    BlockSpec(3, [LotRun(1, 18)]),
    BlockSpec(4, [LotRun(1, 6), LotRun(8, 13)]),
    BlockSpec(5, [LotRun(1, 40)]),
    BlockSpec(6, [LotRun(1, 24)]),
    BlockSpec(7, [LotRun(1, 24)]),
    BlockSpec(8, [LotRun(1, 7), LotRun(9, 19), LotRun(21, 24)]),
    BlockSpec(9, [LotRun(1, 24)]),
    BlockSpec(10, [LotRun(1, 1), LotRun(3, 12)]),
  ];

  /// Phase 5 — Daniella units with the open-space amenities. Site plan MV5.
  static const List<BlockSpec> _phase5 = [
    BlockSpec(1, [
      LotRun(1, 10),
      LotRun(12, 15),
      LotRun(17, 19),
      LotRun(21, 25),
      LotRun(27, 29),
      LotRun(31, 40),
      LotRun(42, 63),
      LotRun(65, 67),
    ]),
    BlockSpec(2, [LotRun(1, 6), LotRun(8, 12)]),
    BlockSpec(3, [LotRun(1, 1), LotRun(3, 10), LotRun(12, 12)]),
    BlockSpec(4, [
      LotRun(1, 3),
      LotRun(5, 5),
      LotRun(7, 13),
      LotRun(15, 15),
    ]),
    BlockSpec(5, [LotRun(1, 9), LotRun(11, 14)]),
  ];

  /// Keyed by phase. Every phase the estate has appears here. An absent key and
  /// an empty list mean different things, and only the empty list can be
  /// reported honestly — see [phasesAwaitingData].
  static const Map<String, List<BlockSpec>> _blocksByPhase = {
    '1': _phase1,
    '2': _phase2,
    '3': _phase3,
    '5': _phase5,
  };

  /// Phases that exist on the ground but have no schedule loaded.
  ///
  /// Empty now that all four are in. Kept because it is the mechanism that
  /// stopped the app claiming a resident's lot did not exist when the truth was
  /// that nobody had typed it in yet — and the next phase the estate builds will
  /// need it again.
  static List<String> get phasesAwaitingData => [
        for (final phase in MapConstants.subdivisionPhases)
          if ((_blocksByPhase[phase] ?? const []).isEmpty) phase,
      ];

  static bool hasData(String phase) =>
      (_blocksByPhase[phase] ?? const []).isNotEmpty;

  /// Phases that DO have a schedule, in estate order.
  static List<String> get loadedPhases => [
        for (final phase in MapConstants.subdivisionPhases)
          if (hasData(phase)) phase,
      ];

  static List<BlockSpec> blocksIn(String phase) =>
      _blocksByPhase[phase] ?? const [];

  /// "Blocks 1-20" — the span of block numbers in a phase, for the map badge's
  /// subtitle when a phase is known but no lot has been chosen.
  ///
  /// Says nothing about which lots exist inside those blocks; [blocksIn] is the
  /// authority for that.
  static String? blockSpanLabel(String phase) {
    final blocks = blocksIn(phase);
    if (blocks.isEmpty) return null;
    final first = blocks.first.block;
    final last = blocks.last.block;
    return first == last ? 'Block $first' : 'Blocks $first-$last';
  }

  /// The block numbers a phase really has, in order, as option strings for a
  /// picker. Empty for an unknown phase.
  static List<String> blockNumbersIn(String phase) => [
        for (final spec in blocksIn(phase)) spec.block.toString(),
      ];

  /// The lot numbers a block really has, expanded from its runs so the gaps
  /// stay gaps — Phase 2 Block 11 offers its 46 real lots, not 1-56.
  static List<String> lotNumbersIn(String phase, int block) {
    for (final spec in blocksIn(phase)) {
      if (spec.block != block) continue;
      return [
        for (final run in spec.runs)
          for (var lot = run.first; lot <= run.last; lot++) lot.toString(),
      ];
    }
    return const [];
  }

  static int lotCountIn(String phase) {
    var total = 0;
    for (final spec in blocksIn(phase)) {
      total += spec.lotCount;
    }
    return total;
  }

  /// Every address, ordered phase → block → lot.
  ///
  /// Static fields are lazily initialised in Dart, so the 1,444 entries are
  /// built on the first search rather than at class-load: the report screen
  /// opens on the category step, and a resident who never reaches the location
  /// step does not pay for this list.
  static final List<SubdivisionAddress> all = [
    for (final phase in MapConstants.subdivisionPhases)
      for (final spec in _blocksByPhase[phase] ?? const <BlockSpec>[])
        for (final run in spec.runs)
          for (var lot = run.first; lot <= run.last; lot++)
            SubdivisionAddress(phase: phase, block: spec.block, lot: lot),
  ];

  static int get addressCount => all.length;

  /// True only if the estate genuinely has this lot.
  static bool exists(String phase, int block, int lot) =>
      blocksIn(phase).any((s) => s.block == block && s.contains(lot));

  // ── Search ────────────────────────────────────────────────────────────────

  static final RegExp _phaseToken = RegExp(r'ph(?:ase)?\s*0*(\d+)');
  static final RegExp _blockToken = RegExp(r'(?:blk|block|bl)\s*0*(\d+)');
  static final RegExp _lotToken = RegExp(r'lot\s*0*(\d+)');
  static final RegExp _bareNumber = RegExp(r'\d+');
  static final RegExp _hasLetter = RegExp(r'[a-z]');

  /// Grab-style incremental search over the directory.
  ///
  /// Understands three shapes, in this order of precedence:
  ///
  ///   1. LABELLED tokens anywhere in the query — "blk 2", "Phase 1 lot 12",
  ///      "lot 40 block 13". Each labelled token pins that component.
  ///   2. BARE numbers filling whatever components the labels left open, in
  ///      phase → block → lot order. So "1 4 12" is Phase 1, Block 4, Lot 12,
  ///      and "phase 1 4" is Phase 1, Block 4.
  ///   3. Plain substring against the rendered label, so typing the address the
  ///      way it is displayed also works.
  ///
  /// Returns EMPTY for an empty query. That is deliberate and is the difference
  /// between this and a dropdown: opening the field must not dump 1,444 rows at
  /// someone who has not asked for anything.
  static List<SubdivisionAddress> search(String query, {int limit = 20}) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return const [];

    String? phase;
    int? block;
    int? lot;

    // Labelled tokens first — they are unambiguous, so they win over position.
    var residue = q;
    final phaseMatch = _phaseToken.firstMatch(residue);
    if (phaseMatch != null) {
      phase = phaseMatch.group(1);
      residue = residue.replaceRange(phaseMatch.start, phaseMatch.end, ' ');
    }
    final blockMatch = _blockToken.firstMatch(residue);
    if (blockMatch != null) {
      block = int.tryParse(blockMatch.group(1)!);
      residue = residue.replaceRange(blockMatch.start, blockMatch.end, ' ');
    }
    final lotMatch = _lotToken.firstMatch(residue);
    if (lotMatch != null) {
      lot = int.tryParse(lotMatch.group(1)!);
      residue = residue.replaceRange(lotMatch.start, lotMatch.end, ' ');
    }

    // Bare numbers fill the components the labels did not pin.
    for (final m in _bareNumber.allMatches(residue)) {
      final value = int.tryParse(m.group(0)!);
      if (value == null) continue;
      if (phase == null) {
        phase = value.toString();
        continue;
      }
      if (block == null) {
        block = value;
        continue;
      }
      // Anything past the third number is ignored rather than overwriting the
      // lot — "1 4 12 12" should still mean Phase 1, Block 4, Lot 12.
      lot ??= value;
    }

    final structured = phase != null || block != null || lot != null;
    final results = <SubdivisionAddress>[];

    if (structured) {
      for (final address in all) {
        if (phase != null && address.phase != phase) continue;
        if (block != null && address.block != block) continue;
        if (lot != null && address.lot != lot) continue;
        results.add(address);
        if (results.length >= limit) break;
      }
    }

    // Substring fallback, for anyone typing the label as displayed.
    //
    // Skipped for all-digit queries: those are fully answered by the structured
    // pass above, and running this anyway would build and lower-case 1,444
    // label strings on every keystroke to arrive at the same empty list.
    if (results.isEmpty && _hasLetter.hasMatch(q)) {
      for (final address in all) {
        if (!address.label.toLowerCase().contains(q)) continue;
        results.add(address);
        if (results.length >= limit) break;
      }
    }

    return results;
  }
}
