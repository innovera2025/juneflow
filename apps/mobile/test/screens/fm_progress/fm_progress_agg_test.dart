// Unit tests for the fm-progress derivation (B-436, gate G3).
//
// Expected values come from pototype/mobile-field.jsx MFmProgress (L92-143) and from
// the endpoint's own rules (timeline.ts readPct: 0-100 inclusive), not from the
// implementation.
//
// The properties worth protecting: an unsubmitted edit must never look saved, a
// submit must send ONLY what changed, and the +/- controls must not be able to dial
// a value the server will refuse.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/fm_progress/fm_progress_agg.dart';

WireRow task({String id = 't-1', String? label = 'Slab pour L2', Object? pct = 80}) =>
    <String, Object?>{
      'id': id,
      'label': label,
      'group_label': '02 Structure',
      'pct': pct,
    };

void main() {
  group('narrowing the timeline read', () {
    test('reads the stored percentage and starts the draft equal to it', () {
      final List<ProgressLine> lines = toLines(<WireRow>[task()]);
      expect(lines, hasLength(1));
      expect(lines.first.storedPct, 80);
      expect(lines.first.draftPct, 80);
      expect(lines.first.dirty, isFalse);
    });

    test('accepts numeric(5,2) as the STRING node-postgres returns', () {
      // A parse that only accepted num would zero every percentage on a real
      // response, and the screen would offer to overwrite real progress with 0.
      expect(toLines(<WireRow>[task(pct: '92.00')]).first.storedPct, 92);
    });

    test('treats a missing percentage as 0 rather than crashing', () {
      expect(toLines(<WireRow>[task(pct: null)]).first.storedPct, 0);
    });

    test('drops a row with no id — the write addresses a task BY id', () {
      // A line the screen could not submit would be a control that silently does
      // nothing when tapped.
      final List<WireRow> rows = <WireRow>[
        <String, Object?>{'label': 'no id', 'pct': 10},
        task(),
      ];
      expect(toLines(rows).map((ProgressLine l) => l.id), <String>['t-1']);
    });

    test('keeps a null label rather than substituting a prototype name', () {
      expect(toLines(<WireRow>[task(label: null)]).first.label, isNull);
    });
  });

  group('the +/- controls', () {
    test('moves by the prototype step of 5', () {
      expect(kProgressStep, 5);
      final List<ProgressLine> lines = adjust(toLines(<WireRow>[task()]), 0, kProgressStep);
      expect(lines.first.draftPct, 85);
      expect(lines.first.dirty, isTrue);
    });

    test('cannot dial past either end of what the endpoint accepts', () {
      // timeline.ts 400s anything outside 0-100, and a foreman cannot act on a 400.
      expect(adjust(toLines(<WireRow>[task(pct: 98)]), 0, 5).first.draftPct, 100);
      expect(adjust(toLines(<WireRow>[task(pct: 2)]), 0, -5).first.draftPct, 0);
    });

    test('leaves the STORED value alone, so the caption still shows what the server holds', () {
      final ProgressLine line = adjust(toLines(<WireRow>[task()]), 0, 5).first;
      expect(line.storedPct, 80);
      expect(line.draftPct, 85);
    });

    test('ignores an out-of-range index instead of throwing', () {
      final List<ProgressLine> lines = toLines(<WireRow>[task()]);
      expect(adjust(lines, 5, 5), same(lines));
      expect(adjust(lines, -1, 5), same(lines));
    });

    test('touches only the line that was tapped', () {
      final List<ProgressLine> lines = adjust(
        toLines(<WireRow>[task(id: 'a'), task(id: 'b', pct: 30)]),
        1,
        5,
      );
      expect(lines[0].draftPct, 80);
      expect(lines[1].draftPct, 35);
    });
  });

  group('the zone average', () {
    test('is the mean of the DRAFT values, rounded once', () {
      final List<ProgressLine> lines = toLines(<WireRow>[
        task(id: 'a', pct: 80),
        task(id: 'b', pct: 55),
        task(id: 'c', pct: 30),
        task(id: 'd', pct: 95),
      ]);
      expect(averagePct(lines), 65); // (80+55+30+95)/4 = 65
    });

    test('follows an edit before it is submitted', () {
      final List<ProgressLine> lines = adjust(
        toLines(<WireRow>[task(id: 'a', pct: 80), task(id: 'b', pct: 60)]),
        1,
        20,
      );
      expect(averagePct(lines), 80);
    });

    test('has NO average for an empty schedule, rather than 0%', () {
      // 0% would read as "no work done" when the truth is "no activities".
      expect(averagePct(const <ProgressLine>[]), isNull);
    });
  });

  group('what a submit sends', () {
    test('sends only the lines whose draft differs from the server', () {
      // Re-sending an untouched line would write a value nobody reported, and make
      // every submit look like a report on every activity.
      final List<ProgressLine> lines = adjust(
        toLines(<WireRow>[task(id: 'a'), task(id: 'b'), task(id: 'c')]),
        1,
        5,
      );
      expect(pendingLines(lines).map((ProgressLine l) => l.id), <String>['b']);
    });

    test('sends nothing when nothing was touched', () {
      expect(pendingLines(toLines(<WireRow>[task()])), isEmpty);
    });

    test('sends nothing when an edit was dialled back to where it started', () {
      List<ProgressLine> lines = toLines(<WireRow>[task()]);
      lines = adjust(lines, 0, 5);
      lines = adjust(lines, 0, -5);
      expect(pendingLines(lines), isEmpty);
    });
  });

  group('clampPct', () {
    test('holds a value inside the endpoint range, inclusive at both ends', () {
      expect(clampPct(-1), 0);
      expect(clampPct(0), 0);
      expect(clampPct(100), 100);
      expect(clampPct(101), 100);
      expect(clampPct(47), 47);
    });
  });
}
