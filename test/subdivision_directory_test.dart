import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

import 'package:monticello_villas_app/features/property/data/phase_regions.dart';
import 'package:monticello_villas_app/features/property/data/subdivision_directory.dart';

void main() {
  group('SubdivisionDirectory — the schedule is the survey', () {
    test('all four phases are loaded, at the surveyed sizes', () {
      expect(SubdivisionDirectory.lotCountIn('1'), 457);
      expect(SubdivisionDirectory.lotCountIn('2'), 541);
      expect(SubdivisionDirectory.lotCountIn('3'), 340);
      expect(SubdivisionDirectory.lotCountIn('5'), 106);
      expect(SubdivisionDirectory.addressCount, 1444);

      expect(SubdivisionDirectory.blocksIn('1').length, 12);
      expect(SubdivisionDirectory.blocksIn('2').length, 20);
      expect(SubdivisionDirectory.blocksIn('3').length, 10);
      expect(SubdivisionDirectory.blocksIn('5').length, 5);
    });

    test('nothing is awaiting data any more, but the mechanism survives', () {
      expect(SubdivisionDirectory.phasesAwaitingData, isEmpty);
      expect(SubdivisionDirectory.loadedPhases, ['1', '2', '3', '5']);
      for (final phase in ['1', '2', '3', '5']) {
        expect(SubdivisionDirectory.hasData(phase), isTrue);
      }
    });

    // The irregularities in the supplied data, pinned so a future "tidy-up"
    // that regenerates blocks as 1..n and lots as 1..n fails here rather than
    // silently offering guards addresses that do not exist.
    test('Phase 1 has no Block 1, and its Block 3 starts at Lot 25', () {
      expect(SubdivisionDirectory.exists('1', 1, 1), isFalse);
      expect(SubdivisionDirectory.blocksIn('1').first.block, 2);

      expect(SubdivisionDirectory.exists('1', 3, 24), isFalse);
      expect(SubdivisionDirectory.exists('1', 3, 25), isTrue);
      expect(SubdivisionDirectory.exists('1', 3, 60), isTrue);
      expect(SubdivisionDirectory.exists('1', 3, 61), isFalse);
    });

    test('Phase 2 Block 18 has no Lot 1', () {
      expect(SubdivisionDirectory.exists('2', 18, 1), isFalse);
      expect(SubdivisionDirectory.exists('2', 18, 2), isTrue);
    });
  });

  group('the schedule matches the supplied specification, block for block', () {
    // The estate's lot schedule, transcribed from the specification rather than
    // derived from the code. Every string is what `BlockSpec.lotSummary`
    // renders, so a mistyped run in the dataset fails HERE with both versions
    // side by side, instead of surfacing months later as a lot a guard cannot
    // find. This is the whole dataset — 47 blocks — on purpose.
    const spec = <String, Map<int, String>>{
      '1': {
        2: '1-66',
        3: '25-60',
        4: '1-50',
        5: '1-39',
        6: '1-35',
        7: '1-33',
        8: '1-30',
        9: '1-30',
        10: '1-32',
        11: '1-32',
        12: '1-34',
        13: '1-40',
      },
      '2': {
        1: '1-3, 5-30',
        2: '1-28',
        3: '1, 3-28',
        4: '1-4, 6-28',
        5: '1-28',
        6: '1-3, 5-6, 8-16, 18-35, 37-38',
        7: '1-38',
        8: '1-2, 4-9, 11-13, 15-16, 18-27, 29-30, 32-36',
        9: '1-9, 11-23, 25-27, 29-36',
        10: '1-28, 30-32, 34-44',
        11: '1, 4-7, 10-11, 13-19, 21-25, 27-28, 30-44, 46-50, 52-56',
        12: '1-7, 9-20',
        13: '1-2, 4-24, 26-30',
        14: '1-11, 15, 17-19, 21, 23-28',
        15: '1-3, 5-7, 9-16, 18-25',
        16: '1-5, 7-14, 16-22',
        17: '1-4, 6-12, 14, 16, 19-20',
        18: '2-5, 7-9, 11-13, 17-20',
        19: '1-2, 4-11, 13-18',
        20: '1-23',
      },
      '3': {
        1: '1-3, 5-9, 11-38, 40-111',
        2: '1-26, 28-58',
        3: '1-18',
        4: '1-6, 8-13',
        5: '1-40',
        6: '1-24',
        7: '1-24',
        8: '1-7, 9-19, 21-24',
        9: '1-24',
        10: '1, 3-12',
      },
      '5': {
        1: '1-10, 12-15, 17-19, 21-25, 27-29, 31-40, 42-63, 65-67',
        2: '1-6, 8-12',
        3: '1, 3-10, 12',
        4: '1-3, 5, 7-13, 15',
        5: '1-9, 11-14',
      },
    };

    for (final entry in spec.entries) {
      final phase = entry.key;
      final blocks = entry.value;

      test('Phase $phase carries exactly its ${blocks.length} blocks', () {
        final actual = SubdivisionDirectory.blocksIn(phase);
        expect(
          actual.map((b) => b.block).toList(),
          blocks.keys.toList(),
          reason: 'Phase $phase block numbers, in order',
        );
      });

      blocks.forEach((block, lots) {
        test('Phase $phase Block $block has lots $lots', () {
          final spec = SubdivisionDirectory.blocksIn(phase)
              .where((b) => b.block == block);
          expect(spec, isNotEmpty, reason: 'Phase $phase has no Block $block');
          expect(spec.single.lotSummary, lots);
        });
      });
    }
  });

  group('SubdivisionDirectory — gaps inside a block', () {
    // This is the whole reason a block holds a LIST of runs. A first/last pair
    // would say "Phase 2 Block 11, Lots 1-56" and hand a guard ten addresses
    // that are open space, an easement or a road.
    test('Phase 2 Block 11 keeps every one of its nine runs', () {
      const holes = [2, 3, 8, 9, 12, 20, 26, 29, 45, 51];
      for (final lot in holes) {
        expect(SubdivisionDirectory.exists('2', 11, lot), isFalse,
            reason: 'Lot $lot is not in the Block 11 schedule');
      }
      for (final lot in [1, 4, 7, 10, 19, 25, 30, 44, 50, 56]) {
        expect(SubdivisionDirectory.exists('2', 11, lot), isTrue,
            reason: 'Lot $lot IS in the Block 11 schedule');
      }
      expect(SubdivisionDirectory.exists('2', 11, 57), isFalse);

      final block11 =
          SubdivisionDirectory.blocksIn('2').firstWhere((b) => b.block == 11);
      expect(block11.hasGaps, isTrue);
      expect(block11.lotCount, 46);
      // The span overstates the count by exactly the ten missing numbers —
      // which is the trap this model exists to avoid.
      expect(block11.lastLot - block11.firstLot + 1, 56);
      expect(
        block11.lotSummary,
        '1, 4-7, 10-11, 13-19, 21-25, 27-28, 30-44, 46-50, 52-56',
      );
    });

    test('Phase 3 Block 1 runs to Lot 111 with two holes', () {
      expect(SubdivisionDirectory.exists('3', 1, 4), isFalse);
      expect(SubdivisionDirectory.exists('3', 1, 10), isFalse);
      expect(SubdivisionDirectory.exists('3', 1, 39), isFalse);
      expect(SubdivisionDirectory.exists('3', 1, 111), isTrue);
      expect(SubdivisionDirectory.exists('3', 1, 112), isFalse);
    });

    test('Phase 5 Block 1 is 60 lots spread over 67 numbers', () {
      final block1 =
          SubdivisionDirectory.blocksIn('5').firstWhere((b) => b.block == 1);
      expect(block1.lotCount, 60);
      expect(block1.lastLot, 67);
      for (final lot in [11, 16, 20, 26, 30, 41, 64]) {
        expect(SubdivisionDirectory.exists('5', 1, lot), isFalse);
      }
      expect(SubdivisionDirectory.exists('5', 1, 67), isTrue);
    });

    test('a single-lot run renders as one number, not a range', () {
      final block3 =
          SubdivisionDirectory.blocksIn('5').firstWhere((b) => b.block == 3);
      expect(block3.lotSummary, '1, 3-10, 12');
    });

    test('a block with no gaps says so', () {
      final block20 =
          SubdivisionDirectory.blocksIn('2').firstWhere((b) => b.block == 20);
      expect(block20.hasGaps, isFalse);
      expect(block20.lotSummary, '1-23');
    });
  });

  group('SubdivisionDirectory.search', () {
    test('an empty query returns nothing at all', () {
      // The whole difference between this and a dropdown. A blank search must
      // not answer itself with all 1,444 lots.
      expect(SubdivisionDirectory.search(''), isEmpty);
      expect(SubdivisionDirectory.search('   '), isEmpty);
    });

    test('a labelled token pins its own component', () {
      final results = SubdivisionDirectory.search('blk 2');
      expect(results, isNotEmpty);
      expect(results.every((a) => a.block == 2), isTrue);
    });

    test('bare numbers fill phase, then block, then lot', () {
      final results = SubdivisionDirectory.search('2 11 56');
      expect(results.length, 1);
      expect(results.single.phase, '2');
      expect(results.single.block, 11);
      expect(results.single.lot, 56);
    });

    test('labelled tokens win over position, in any order', () {
      final results = SubdivisionDirectory.search('phase 3 lot 111 block 1');
      expect(results.length, 1);
      expect(results.single.label, 'Phase 3, Block 1, Lot 111');
    });

    test('a lot inside a gap matches nothing', () {
      expect(SubdivisionDirectory.search('phase 2 block 11 lot 45'), isEmpty);
      expect(SubdivisionDirectory.search('phase 3 block 1 lot 39'), isEmpty);
    });

    test('the rendered label is itself searchable', () {
      final results = SubdivisionDirectory.search('Phase 5, Block 4, Lot 15');
      expect(results.single.label, 'Phase 5, Block 4, Lot 15');
    });

    test('results are capped so a broad query stays a list, not a dump', () {
      expect(SubdivisionDirectory.search('phase 2').length, 20);
    });
  });

  group('SubdivisionAddress', () {
    test('renders the standard two-line hierarchy', () {
      const address = SubdivisionAddress(phase: '2', block: 11, lot: 56);
      expect(address.label, 'Phase 2, Block 11, Lot 56');
      expect(address.planCode, 'MV2');
      expect(address.subtitle, 'Monticello Villas (MV2)');
    });

    test('storageKey round-trips through parse', () {
      const address = SubdivisionAddress(phase: '3', block: 1, lot: 111);
      expect(SubdivisionAddress.parse(address.storageKey), address);
    });

    test('malformed stored values are dropped, not guessed at', () {
      expect(SubdivisionAddress.parse('rubbish'), isNull);
      expect(SubdivisionAddress.parse('1/4'), isNull);
      expect(SubdivisionAddress.parse('1/x/12'), isNull);
    });

    test('equality is structural, so recents can de-duplicate', () {
      const a = SubdivisionAddress(phase: '1', block: 4, lot: 12);
      // Deliberately NOT a second const literal. Dart canonicalises identical
      // consts to one instance, so `{a, b}` would collapse to a single element
      // even if `==` and `hashCode` were never implemented — the test would
      // pass while testing nothing. Round-tripping through parse produces a
      // genuinely separate object, which is also how a recent arrives: read
      // back off disk, not held over from the session that stored it.
      final b = SubdivisionAddress.parse('1/4/12')!;

      expect(identical(a, b), isFalse);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect({a, b}.length, 1);
    });
  });

  group('PhaseRegions', () {
    test('every anchor resolves to its own phase, confidently', () {
      for (final anchor in PhaseRegions.anchors) {
        final match = PhaseRegions.nearest(anchor.centre);
        expect(match, isNotNull);
        expect(match!.phase, anchor.phase);
        expect(match.confident, isTrue);
        expect(match.metres, lessThan(1));
      }
    });

    test('the four anchors cover the four phases the estate has', () {
      expect(
        PhaseRegions.anchors.map((a) => a.phase).toList(),
        ['1', '2', '3', '5'],
      );
    });

    test('every anchor sits INSIDE the geofence', () {
      // Load-bearing. An anchor outside the boundary would mean the pill and
      // badge read "Outside Monticello Villas" for every resident of that
      // phase, and the picker would refuse to commit their pin — 541 lots, in
      // Phase 2's case.
      for (final anchor in PhaseRegions.anchors) {
        expect(PhaseRegions.describe(anchor.centre),
            'Nearby: Phase ${anchor.phase}',
            reason: 'Phase ${anchor.phase} anchor fell outside the boundary');
      }
    });

    test('open ground between clusters names no phase', () {
      // The south-west field: inside the premises, but 358 m from the nearest
      // housing cluster. Naming a phase there would be arithmetic, not
      // knowledge — so the read-out must degrade instead.
      const field = LatLng(10.7615, 122.5140);
      final match = PhaseRegions.nearest(field);
      expect(match, isNotNull);
      expect(match!.confident, isFalse);
      expect(PhaseRegions.describe(field), 'Inside Monticello Villas');
    });

    test('a point well outside the premises is called out as such', () {
      // North of Angela Avenue, across the highway.
      expect(
        PhaseRegions.describe(const LatLng(10.7760, 122.5165)),
        'Outside Monticello Villas',
      );
    });
  });

  group('PhaseRegions.badgeLines', () {
    test('names the phase and its block span, never a block it detected', () {
      final lines = PhaseRegions.badgeLines(PhaseRegions.anchors[1].centre);
      expect(lines.primary, 'Phase 2');
      expect(lines.subtitle, 'Monticello Villas (MV2) · Blocks 1-20');
    });

    test('degrades to the estate name on open ground', () {
      final lines = PhaseRegions.badgeLines(const LatLng(10.7615, 122.5140));
      expect(lines.primary, 'Monticello Villas');
      expect(lines.subtitle, 'Inside the premises');
    });

    test('drops the subtitle entirely when outside', () {
      final lines = PhaseRegions.badgeLines(const LatLng(10.7760, 122.5165));
      expect(lines.primary, 'Outside the village');
      expect(lines.subtitle, isNull);
    });
  });
}
