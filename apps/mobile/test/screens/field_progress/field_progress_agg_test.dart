// Unit tests for the field-progress parse + honest derivations.
//
// Pure Dart — no Flutter, no network. Each test pins ONE honest rule, so reverting
// that rule turns exactly this test red. The percentage rule gets its own group,
// because it is the specific error this screen exists to avoid.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/field_progress/field_progress_agg.dart';

/// A contract row shaped exactly like contractWire (subcon.ts L294-309).
FieldProgressEnt _contract({
  String id = 'c1',
  String? no = 'SC-2026-001',
  String? vendorId = 'v1',
}) => <String, Object?>{
  'id': id,
  'no': no,
  'vendor_id': vendorId,
  'project_id': 'proj1',
  'value': 5000000,
  'currency_code': 'THB',
  'retention_pct': 5,
  'start': '2026-01-01',
  'end': '2026-12-31',
};

/// A period row shaped exactly like enrichPeriodRow (subcon.ts L505-524).
FieldProgressEnt _period({
  String id = 'p1',
  Object? seq = 1,
  String status = 'pending',
  Object? pct = 30,
  String? projectName = 'Ratchaphruek',
}) => <String, Object?>{
  'id': id,
  'contract_id': 'c1',
  'seq': seq,
  'basis': 'percent',
  'target': 0,
  'pct': pct,
  'amount': 645000,
  'currency_code': 'THB',
  'status': status,
  'project_name': projectName,
  'title': 'SC-2026-001',
  'owner': null,
  'defect': null,
};

void main() {
  group('contracts', () {
    test('the vendor NAME comes from the real /vendors join', () {
      final List<FieldProgressContract> rows = parseContracts(
        <FieldProgressEnt>[_contract()],
        <FieldProgressEnt>[
          <String, Object?>{'id': 'v1', 'name': 'Rungruang Construction'},
        ],
      );
      expect(rows.single.vendorName, 'Rungruang Construction');
      expect(rows.single.no, 'SC-2026-001');
    });

    test('an unresolved vendor stays null — never the id as a name', () {
      final List<FieldProgressContract> rows = parseContracts(
        <FieldProgressEnt>[_contract(vendorId: 'missing')],
        const <FieldProgressEnt>[],
      );
      expect(rows.single.vendorName, isNull);
      expect(rows.single.vendorId, 'missing');
    });

    test('a vendor row missing either half is skipped', () {
      final Map<String, String> names = fieldProgressVendorNames(
        <FieldProgressEnt>[
          <String, Object?>{'id': 'v1'},
          <String, Object?>{'name': 'No Id Co'},
          <String, Object?>{'id': 'v2', 'name': 'Real Co'},
        ],
      );
      expect(names, <String, String>{'v2': 'Real Co'});
    });

    test('contracts sort by doc number, un-numbered last, id-less dropped', () {
      final List<FieldProgressContract> rows =
          parseContracts(<FieldProgressEnt>[
            _contract(id: 'b', no: 'SC-002'),
            _contract(id: '', no: 'SC-000'),
            _contract(id: 'nonum', no: null),
            _contract(id: 'a', no: 'SC-001'),
          ], const <FieldProgressEnt>[]);
      expect(rows.map((FieldProgressContract c) => c.id).toList(), <String>[
        'a',
        'b',
        'nonum',
      ]);
    });
  });

  group('periods', () {
    test('a period carries its REAL status and ordinal', () {
      final FieldProgressPeriod p = parsePeriod(_period(seq: '4'));
      expect(p.id, 'p1');
      expect(p.seq, 4);
      expect(p.status, 'pending');
      expect(p.projectName, 'Ratchaphruek');
    });

    test('only a PENDING period is deliverable', () {
      expect(parsePeriod(_period(status: 'pending')).deliverable, isTrue);
      // The endpoint 409s on anything else (subcon.ts L754-759), so the action must
      // not be offered.
      for (final String s in <String>[
        'delivered',
        'inspecting',
        'passed',
        'rejected',
        'paid',
      ]) {
        expect(parsePeriod(_period(status: s)).deliverable, isFalse, reason: s);
      }
    });

    test('periods come back in seq order, id-less rows dropped', () {
      final List<FieldProgressPeriod> rows = parsePeriods(<FieldProgressEnt>[
        _period(id: 'c', seq: 3),
        _period(id: '', seq: 0),
        _period(id: 'a', seq: 1),
        _period(id: 'b', seq: 2),
      ]);
      expect(rows.map((FieldProgressPeriod p) => p.id).toList(), <String>[
        'a',
        'b',
        'c',
      ]);
    });
  });

  group('the percentage is never synthesised', () {
    test('the typed period exposes NO completion field at all', () {
      // The whole guard: there is no percent-complete on the projection, so no view
      // can render one by accident. `pct` is deliberately NOT parsed — it is the
      // period's TARGET share of the contract under the percent basis, not progress.
      final FieldProgressPeriod p = parsePeriod(_period(pct: 78));
      expect(p.status, 'pending');
      // If a `percentComplete`-style field is ever added, this documentation
      // constant is where the reason it must not be lives.
      expect(FieldProgressPeriod.percentComplete, contains('withheld'));
    });

    test('a delivered COUNT is not turned into a completion ratio', () {
      // 3 of 4 periods delivered is NOT "75% complete": periods are unequal by
      // construction (percent / distance / unit / milestone bases), so numerator and
      // denominator do not measure the same quantity. Nothing in the agg computes
      // such a ratio — assert the surface stays free of one.
      final List<FieldProgressPeriod> rows = parsePeriods(<FieldProgressEnt>[
        _period(id: 'a', seq: 1, status: 'delivered'),
        _period(id: 'b', seq: 2, status: 'delivered'),
        _period(id: 'c', seq: 3, status: 'delivered'),
        _period(id: 'd', seq: 4, status: 'pending'),
      ]);
      expect(rows.length, 4);
      expect(
        rows.where((FieldProgressPeriod p) => p.deliverable).length,
        1,
        reason: 'only the pending one may be acted on',
      );
    });
  });

  group('deliver payload', () {
    test('sends empty docs + photos, and nothing else', () {
      final Map<String, Object?> body = deliverPayload();
      expect(body.keys.toSet(), <String>{'docs', 'photos'});
      expect(body['docs'], isEmpty);
      expect(body['photos'], isEmpty);
    });

    test('no monetary field and no percentage is ever sent', () {
      final Map<String, Object?> body = deliverPayload();
      for (final String k in <String>[
        'amount',
        'value',
        'currency_code',
        'pct',
        'percent',
        'progress',
      ]) {
        expect(body.containsKey(k), isFalse, reason: k);
      }
    });
  });

  group('deliver state resolution', () {
    const String opId = 'op-1';

    SyncOperation op(SyncOpStatus status) => SyncOperation(
      id: opId,
      entityType: 'work_period_deliver',
      kind: SyncOpKind.update,
      endpoint: '/periods/p1/deliver',
      method: 'POST',
      payload: deliverPayload(),
      createdAt: DateTime.utc(2026),
      status: status,
    );

    test('a synced attempt is SENT', () {
      expect(
        resolveDeliverState(
          opId,
          const DrainReport(<SyncAttempt>[
            SyncAttempt(id: opId, outcome: SyncOutcome.synced),
          ]),
          const <SyncOperation>[],
        ),
        FieldDeliverState.sent,
      );
    });

    test('a deferred attempt is QUEUED — captured, never a success', () {
      expect(
        resolveDeliverState(
          opId,
          const DrainReport(<SyncAttempt>[
            SyncAttempt(id: opId, outcome: SyncOutcome.deferred),
          ]),
          const <SyncOperation>[],
        ),
        FieldDeliverState.queued,
      );
    });

    test(
      'a permanent failure is FAILED (this is where a replay 409 lands)',
      () {
        expect(
          resolveDeliverState(
            opId,
            const DrainReport(<SyncAttempt>[
              SyncAttempt(id: opId, outcome: SyncOutcome.permanentlyFailed),
            ]),
            const <SyncOperation>[],
          ),
          FieldDeliverState.failed,
        );
      },
    );

    test('with no attempt this pass, the QUEUE is the source of truth', () {
      const DrainReport untouched = DrainReport(<SyncAttempt>[]);
      expect(
        resolveDeliverState(opId, untouched, <SyncOperation>[
          op(SyncOpStatus.pending),
        ]),
        FieldDeliverState.queued,
      );
      expect(
        resolveDeliverState(opId, untouched, <SyncOperation>[
          op(SyncOpStatus.failed),
        ]),
        FieldDeliverState.failed,
      );
      // Gone from the queue = the processor removed it = it synced.
      expect(
        resolveDeliverState(opId, untouched, const <SyncOperation>[]),
        FieldDeliverState.sent,
      );
    });
  });

  group('the wire status is never rendered raw', () {
    // `pending | delivered | inspecting | passed | rejected | paid` are ENGLISH
    // machine codes and this is a Thai-only field app. The status is the screen's
    // load-bearing value (it stands where the prototype puts a percentage), so a
    // raw enum there is the whole screen reading as untranslated. Each maps to an
    // EXISTING dict key — the merged web port's own 6→4 collapse.
    test('every wire status maps to a sidecar field, none to itself', () {
      expect(statusLabelField('pending'), 'statusNotReached');
      expect(statusLabelField('delivered'), 'statusRequested');
      expect(statusLabelField('inspecting'), 'statusRequested');
      expect(statusLabelField('passed'), 'statusAccepted');
      expect(statusLabelField('paid'), 'statusAccepted');
      expect(statusLabelField('rejected'), 'statusRejected');
    });

    test('no mapping returns the wire value itself', () {
      for (final String s in <String>[
        'pending',
        'delivered',
        'inspecting',
        'passed',
        'rejected',
        'paid',
      ]) {
        expect(statusLabelField(s), isNot(s));
      }
    });

    test('an UNKNOWN status maps to nothing → the view em-dashes it', () {
      // Deliberately stricter than the web, whose `default:` folds an unknown
      // status into "ยังไม่ถึง". That is a claim about the period; a status this
      // build does not know is not evidence for it.
      expect(statusLabelField('archived'), isNull);
      expect(statusLabelField(''), isNull);
      expect(statusLabelField(null), isNull);
    });
  });
}
