import 'package:flutter_test/flutter_test.dart';

import 'package:monticello_villas_app/core/network/request_pace.dart';
import 'package:monticello_villas_app/core/widgets/network_progress_bar.dart';

void main() {
  setUp(RequestPace.instance.reset);

  group('the pace estimate', () {
    test('starts on the seed and says so', () {
      expect(RequestPace.instance.estimate, RequestPace.seed);
      expect(RequestPace.instance.samples, 0);
    });

    test('the first real sample replaces the seed outright', () {
      // The seed is a guess. Averaging a measurement against a guess makes the
      // first bar of a session paced half by a number nobody measured.
      RequestPace.instance.record(const Duration(milliseconds: 4000));
      expect(RequestPace.instance.estimate,
          const Duration(milliseconds: 4000));
    });

    test('later samples move the estimate without jumping to it', () {
      RequestPace.instance.record(const Duration(milliseconds: 1000));
      RequestPace.instance.record(const Duration(milliseconds: 5000));

      // One slow request on an otherwise quick connection should not repace
      // every bar in the app to five seconds.
      final estimate = RequestPace.instance.estimate;
      expect(estimate, greaterThan(const Duration(milliseconds: 1000)));
      expect(estimate, lessThan(const Duration(milliseconds: 3000)));
    });

    test('follows a connection that has genuinely changed', () {
      RequestPace.instance.record(const Duration(milliseconds: 500));
      // Wi-Fi to a weak cell signal: three samples is all it should take for
      // the bars to start pacing for the network the resident is actually on.
      for (var i = 0; i < 3; i++) {
        RequestPace.instance.record(const Duration(milliseconds: 6000));
      }
      expect(RequestPace.instance.estimate,
          greaterThan(const Duration(milliseconds: 3000)));
    });

    test('clamps to a floor and a ceiling', () {
      RequestPace.instance.record(const Duration(milliseconds: 5));
      expect(RequestPace.instance.estimate, RequestPace.floor,
          reason: 'a bar that finishes before it can be seen is not a bar');

      RequestPace.instance.reset();
      RequestPace.instance.record(const Duration(minutes: 2));
      expect(RequestPace.instance.estimate, RequestPace.ceiling,
          reason: 'one timeout must not freeze every later bar');
    });

    test('times a real call, and times one that threw', () async {
      await RequestPace.instance.measure(
        () => Future<void>.delayed(const Duration(milliseconds: 40)),
      );
      expect(RequestPace.instance.samples, 1);

      await expectLater(
        RequestPace.instance.measure(() async => throw StateError('offline')),
        throwsStateError,
      );
      // A request that failed slowly is still evidence about this connection,
      // and the error is the caller's to handle, not this class's to swallow.
      expect(RequestPace.instance.samples, 2);
    });
  });

  group('the progress curve', () {
    const expected = Duration(seconds: 1);

    double at(double multiplesOfExpected) => NetworkProgressBar.paceFor(
          Duration(
              microseconds:
                  (expected.inMicroseconds * multiplesOfExpected).round()),
          expected,
        );

    test('starts empty', () {
      expect(NetworkProgressBar.paceFor(Duration.zero, expected), 0);
    });

    test('is most of the way there when the request was due', () {
      // The prediction. A bar sitting at a third when the write was expected to
      // land makes every normal delete look like a stall.
      expect(at(1), greaterThan(0.75));
      expect(at(1), lessThan(0.9));
    });

    test('keeps creeping past the prediction, and never arrives', () {
      expect(at(2), greaterThan(at(1)));
      expect(at(8), greaterThan(at(2)));
      // THE POINT OF THIS TEST. The bar cannot know the write is done, so it
      // must never draw the state that means "done" — only a real server
      // acknowledgement closes the last gap.
      expect(at(60), lessThan(1.0));
    });

    test('slows down the longer it waits', () {
      // Progress between 0 and 1× expected against progress over the SAME span
      // seven times later: a stalled network has to look stalled.
      expect(at(1) - at(0), greaterThan((at(8) - at(7)) * 10));
    });

    test('a zero expectation does not divide by nothing', () {
      final p = NetworkProgressBar.paceFor(
          const Duration(seconds: 1), Duration.zero);
      expect(p, greaterThan(0));
      expect(p, lessThan(1));
    });
  });
}
