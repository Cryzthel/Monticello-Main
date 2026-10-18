import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';

/// Guards the refresh cue's AUDIO FILE, not the widget that plays it.
///
/// The sound is an asset, so nothing in the Dart analyzer or the widget tests
/// looks at it — a truncated, silent or clipped file ships exactly as happily
/// as a good one. These are the properties that make it playable and make it
/// subtle, checked against the bytes.
void main() {
  final bytes = File('assets/sounds/refresh_pop.wav').readAsBytesSync();
  final data = ByteData.sublistView(Uint8List.fromList(bytes));

  int u16(int at) => data.getUint16(at, Endian.little);
  int u32(int at) => data.getUint32(at, Endian.little);
  String tag(int at) => String.fromCharCodes(bytes.sublist(at, at + 4));

  group('the pull-to-refresh cue', () {
    test('is a PCM wav in the format the player expects', () {
      expect(tag(0), 'RIFF');
      expect(tag(8), 'WAVE');
      expect(u16(20), 1, reason: 'uncompressed PCM');
      expect(u16(22), 1, reason: 'mono — this is a UI cue, not a stereo image');
      expect(u32(24), 44100);
      expect(u16(34), 16);
    });

    test('is short enough to read as a tap, not a tone', () {
      // Long enough to have a body, short enough that pulling twice in quick
      // succession does not overlap two of them.
      final samples = u32(40) ~/ 2;
      final ms = samples / 44100 * 1000;
      expect(ms, greaterThan(80));
      expect(ms, lessThan(280));
    });

    test('is subtle, and never clips', () {
      // Peaks well below full scale on purpose: this plays on every refresh,
      // and a cue at 0 dBFS is the one a resident turns their volume down for.
      var peak = 0;
      for (var i = 44; i + 1 < bytes.length; i += 2) {
        final v = data.getInt16(i, Endian.little).abs();
        if (v > peak) peak = v;
      }
      expect(peak, greaterThan(6000), reason: 'not silence');
      expect(peak / 32767, lessThan(0.75), reason: 'headroom, no clipping');
    });

    test('starts and ends at silence', () {
      // A non-zero first or last sample is a discontinuity, and a
      // discontinuity is an audible click on top of the sound.
      final n = u32(40) ~/ 2;
      expect(data.getInt16(44, Endian.little), 0);
      expect(data.getInt16(44 + (n - 1) * 2, Endian.little), 0);
    });
  });
}
