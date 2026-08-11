// Unit tests for the fm-accept parse + honest derivations (route fm-accept).
//
// Pure Dart — no Flutter, no network. Each test pins ONE honest rule, so reverting
// that rule turns exactly this test red.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/fm_accept/fm_accept_agg.dart';

/// A period row shaped exactly like enrichPeriodRow (apps/api/src/routes/subcon.ts
/// L505-524) over periodWire (L313-325).
FmAcceptEnt _period({
  String id = 'p1',
  String? title = 'SC-2026-001',
  Object? seq = 3,
  String status = 'delivered',
  String? projectName = 'Ratchaphruek',
  Object? defect,
}) => <String, Object?>{
  'id': id,
  'contract_id': 'c1',
  'seq': seq,
  'basis': 'percent',
  'target': 0,
  'pct': 30,
  'amount': 645000,
  'currency_code': 'THB',
  'status': status,
  'project_name': projectName,
  'title': title,
  'owner': null,
  'defect': defect,
};

/// A gr row shaped exactly like enrichGrRow (subcon.ts L563-577) over grAcceptWire
/// (L379-390).
FmAcceptEnt _gr({
  String id = 'g1',
  String? no = 'GR-2026-0044',
  Object? rejected = 4,
  String status = 'posted',
}) => <String, Object?>{
  'id': id,
  'type': 'gr',
  'no': no,
  'po_id': 'po1',
  'wo_id': null,
  'received': 100,
  'rejected': rejected,
  'status': status,
  'project_name': 'Ratchaphruek',
  'title': no,
  'owner': null,
};

void main() {
  group('row parsing', () {
    test('a period row keeps only real columns', () {
      final FmAcceptRow r = parsePeriodRow(_period());
      expect(r.id, 'p1');
      expect(r.feed, FmAcceptFeed.period);
      // enrichPeriodRow.title is the CONTRACT doc number — the card's doc line.
      expect(r.doc, 'SC-2026-001');
      expect(r.seq, 3);
      expect(r.status, 'delivered');
      expect(r.projectName, 'Ratchaphruek');
      expect(r.rejected, isFalse);
      expect(r.defects, isEmpty);
    });

    test('a null doc number stays null (never a uuid dressed up as one)', () {
      final FmAcceptRow r = parsePeriodRow(_period(title: null));
      expect(r.doc, isNull);
      // The id is still carried — it addresses the POST — but it is not the doc.
      expect(r.id, 'p1');
    });

    test('seq survives the numeric-string wire form', () {
      expect(parsePeriodRow(_period(seq: '7')).seq, 7);
      expect(parsePeriodRow(_period(seq: null)).seq, isNull);
    });

    test('a rejected period carries its REAL Defect List items', () {
      final FmAcceptRow r = parsePeriodRow(
        _period(
          status: 'rejected',
          defect: <Object?>['crack on B-3', '', 42, 'paint peeling'],
        ),
      );
      expect(r.rejected, isTrue);
      // Blank + non-string entries are dropped; nothing is invented to replace them.
      expect(r.defects, <String>['crack on B-3', 'paint peeling']);
    });

    test('a gr row is flagged rejected exactly when rejected > 0', () {
      expect(parseGrRow(_gr(rejected: 4)).rejected, isTrue);
      expect(parseGrRow(_gr(rejected: '2.5')).rejected, isTrue);
      expect(parseGrRow(_gr(rejected: 0)).rejected, isFalse);
      expect(parseGrRow(_gr(rejected: null)).rejected, isFalse);
    });

    test('a gr row has no period ordinal and no defect list', () {
      final FmAcceptRow r = parseGrRow(_gr());
      expect(r.feed, FmAcceptFeed.gr);
      expect(r.doc, 'GR-2026-0044');
      expect(r.seq, isNull);
      expect(r.defects, isEmpty);
    });
  });

  group('actionable', () {
    test('only a delivered or inspecting PERIOD can be inspected', () {
      for (final String s in <String>['delivered', 'inspecting']) {
        expect(
          parsePeriodRow(_period(status: s)).actionable,
          isTrue,
          reason: s,
        );
      }
      // The endpoint's own C3 guard rejects every other status (subcon.ts
      // L819-826), so the buttons must not be offered.
      for (final String s in <String>[
        'pending',
        'rejected',
        'passed',
        'paid',
      ]) {
        expect(
          parsePeriodRow(_period(status: s)).actionable,
          isFalse,
          reason: s,
        );
      }
    });

    test('a goods receipt is NEVER actionable, whatever its status', () {
      // POST /periods/{id}/inspect takes a work-period id; a receipt's decisions are
      // different doors (gr.ts /return, /cancel). The prototype shows the buttons on
      // gr rows anyway because its buttons only toast.
      for (final String s in <String>['delivered', 'inspecting', 'posted']) {
        expect(parseGrRow(_gr(status: s)).actionable, isFalse, reason: s);
      }
    });
  });

  group('queue assembly', () {
    test('both feeds land in one list, ordered by doc then ordinal', () {
      final List<FmAcceptRow> rows = parseAcceptQueue(
        <FmAcceptEnt>[
          _period(id: 'b', title: 'SC-002', seq: 1),
          _period(id: 'a', title: 'SC-001', seq: 2),
          _period(id: 'c', title: 'SC-001', seq: 1),
        ],
        <FmAcceptEnt>[_gr(id: 'g', no: 'GR-900')],
      );
      expect(rows.map((FmAcceptRow r) => r.id).toList(), <String>[
        'g',
        'c',
        'a',
        'b',
      ]);
    });

    test('a row with no id is dropped (it could never be inspected)', () {
      final List<FmAcceptRow> rows = parseAcceptQueue(<FmAcceptEnt>[
        _period(id: ''),
        _period(id: 'ok'),
      ], const <FmAcceptEnt>[]);
      expect(rows.map((FmAcceptRow r) => r.id).toList(), <String>['ok']);
    });

    test('a row with no doc number sorts last, it is not dropped', () {
      final List<FmAcceptRow> rows = parseAcceptQueue(<FmAcceptEnt>[
        _period(id: 'nodoc', title: null),
        _period(id: 'doc', title: 'SC-001'),
      ], const <FmAcceptEnt>[]);
      expect(rows.map((FmAcceptRow r) => r.id).toList(), <String>[
        'doc',
        'nodoc',
      ]);
    });
  });

  group('tab filter (the prototype predicate, mobile-field.jsx L149)', () {
    final List<FmAcceptRow> rows = parseAcceptQueue(
      <FmAcceptEnt>[
        _period(id: 'wait', title: 'A', status: 'delivered'),
        _period(id: 'rej', title: 'B', status: 'rejected'),
      ],
      <FmAcceptEnt>[_gr(id: 'gr', no: 'C', rejected: 3)],
    );

    test('all shows everything', () {
      expect(filterAcceptRows(rows, FmAcceptTab.all).length, 3);
    });

    test('wait is exactly the not-rejected rows', () {
      expect(
        filterAcceptRows(rows, FmAcceptTab.wait).map((FmAcceptRow r) => r.id),
        <String>['wait'],
      );
    });

    test(
      'rejected includes the gr row, because rejected>0 is why it is here',
      () {
        expect(
          filterAcceptRows(
            rows,
            FmAcceptTab.rejected,
          ).map((FmAcceptRow r) => r.id).toSet(),
          <String>{'rej', 'gr'},
        );
      },
    );
  });

  group('inspect payload', () {
    test('a pass sends only the result', () {
      expect(kInspectPassPayload, <String, Object?>{'result': 'pass'});
    });

    test('the ONE payload this port can send is never a reject', () {
      // B-297 item (1). `rejected` is terminal (no transition out of it in
      // subcon.ts) and this screen has no defect form, so a reject would
      // permanently fail the period carrying an EMPTY Defect List. The guarantee is
      // structural: this is the only body in the slice, and it is a `pass`.
      expect(kInspectPassPayload['result'], 'pass');
      expect(kInspectPassPayload.containsKey('defects'), isFalse);
    });

    test('no monetary field is ever sent', () {
      for (final String moneyKey in <String>[
        'amount',
        'value',
        'currency_code',
        'gross',
        'retention',
      ]) {
        expect(
          kInspectPassPayload.containsKey(moneyKey),
          isFalse,
          reason: moneyKey,
        );
      }
    });
  });

  group('no reject door exists anywhere in the slice (B-297 item 1)', () {
    // The strongest available proof that the irreversible action cannot be issued:
    // read the slice's own SOURCE and assert nothing builds a reject body or names
    // a reject result. A future round that re-adds the door without a defect form
    // (and without Wei's B-297 ruling) turns this red.
    const List<String> sources = <String>[
      'lib/screens/fm_accept/fm_accept_agg.dart',
      'lib/screens/fm_accept/fm_accept_repository.dart',
      'lib/screens/fm_accept/fm_accept_screen.dart',
    ];

    test("no source builds a {'result': 'reject'} body", () {
      for (final String path in sources) {
        final String src = File(path).readAsStringSync();
        // Strip comments — the withholding is ARGUED at length in prose, and that
        // prose legitimately contains the word. Only executable code is checked.
        final String code = src
            .split('\n')
            .where(
              (String l) =>
                  !l.trimLeft().startsWith('//') &&
                  !l.trimLeft().startsWith('///'),
            )
            .join('\n');
        expect(
          code.contains("'reject'"),
          isFalse,
          reason: "$path builds a reject result — B-297 item (1) withholds it",
        );
        expect(
          code.contains('FmInspectResult'),
          isFalse,
          reason: '$path still carries the removed pass/reject selector',
        );
      }
    });
  });
}
