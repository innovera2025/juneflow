// Unit tests for the pure pm-jobs aggregation (pm_jobs_agg.dart). No Flutter, no
// network — every derivation is exercised over plain opaque wire maps, proving the
// honest join + status derivation and the done-exclusion.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/pm_jobs/pm_jobs_agg.dart';

/// A WO wire row with only the fields a case cares about (the rest default to "").
PmEnt _wo({
  String id = 'wo',
  String assetId = '',
  String checkinGps = '',
  String customerSign = '',
  Object? items,
}) => <String, Object?>{
  'id': id,
  'asset_id': assetId,
  'checkin_gps': checkinGps,
  'customer_sign': customerSign,
  if (items != null) 'items': items,
};

/// An asset wire row.
PmEnt _asset({
  required String id,
  String name = '',
  String site = '',
  String nextDue = '',
}) => <String, Object?>{
  'id': id,
  'name': name,
  'site': site,
  'next_due': nextDue,
};

void main() {
  group('deriveStatus (real columns only)', () {
    test('customer_sign set -> done', () {
      expect(
        deriveStatus(
          customerSign: 'signed',
          checkinGps: '13,100',
          items: const <Object?>[],
          nextDue: '2000-01-01',
          today: '2026-08-04',
        ),
        PmJobStatus.done,
      );
    });

    test('checked in -> inProgress', () {
      expect(
        deriveStatus(
          customerSign: '',
          checkinGps: '13.7,100.5',
          items: const <Object?>[],
          nextDue: '',
          today: '2026-08-04',
        ),
        PmJobStatus.inProgress,
      );
    });

    test('a filled checklist result -> inProgress', () {
      expect(
        deriveStatus(
          customerSign: '',
          checkinGps: '',
          items: const <Object?>[
            <String, Object?>{'label': 'a', 'result': 'normal'},
          ],
          nextDue: '',
          today: '2026-08-04',
        ),
        PmJobStatus.inProgress,
      );
    });

    test('next_due before today (not started) -> overdue', () {
      expect(
        deriveStatus(
          customerSign: '',
          checkinGps: '',
          items: const <Object?>[],
          nextDue: '2026-08-01',
          today: '2026-08-04',
        ),
        PmJobStatus.overdue,
      );
    });

    test('no signal, due today or later, no next_due -> open', () {
      expect(
        deriveStatus(
          customerSign: '',
          checkinGps: '',
          items: const <Object?>[],
          nextDue: '',
          today: '2026-08-04',
        ),
        PmJobStatus.open,
      );
      expect(
        deriveStatus(
          customerSign: '',
          checkinGps: '',
          items: const <Object?>[],
          nextDue: '2026-08-10',
          today: '2026-08-04',
        ),
        PmJobStatus.open,
      );
    });
  });

  test('anyItemResult: an empty/blank result is not-yet-checked', () {
    expect(anyItemResult(const <Object?>[]), isFalse);
    expect(
      anyItemResult(const <Object?>[
        <String, Object?>{'label': 'a', 'result': ''},
      ]),
      isFalse,
    );
    expect(
      anyItemResult(const <Object?>[
        <String, Object?>{'label': 'a', 'result': 'repair'},
      ]),
      isTrue,
    );
    expect(anyItemResult('not-a-list'), isFalse);
  });

  test('resolveJob joins the asset name/site, em-dash-ready when absent', () {
    final Map<String, PmAssetRef> assets = buildAssetMap(
      <PmEnt>[
        _asset(id: 'a1', name: 'Lift MX-1000', site: 'Tower A'),
      ].map(parseAsset),
    );

    final PmJobRow joined = resolveJob(
      _wo(id: 'w1', assetId: 'a1'),
      assets,
      '2026-08-04',
    );
    expect(joined.name, 'Lift MX-1000');
    expect(joined.site, 'Tower A');

    // A WO whose asset is absent keeps "" (the view renders an em-dash).
    final PmJobRow orphan = resolveJob(
      _wo(id: 'w2', assetId: 'missing'),
      assets,
      '2026-08-04',
    );
    expect(orphan.name, '');
    expect(orphan.site, '');
  });

  test('parseJobs excludes done rows and preserves server order', () {
    final List<PmEnt> workOrders = <PmEnt>[
      _wo(id: 'open', assetId: 'a1'),
      _wo(id: 'done', assetId: 'a1', customerSign: 'signed'),
      _wo(id: 'inprog', assetId: 'a1', checkinGps: '13,100'),
    ];
    final List<PmEnt> assets = <PmEnt>[
      _asset(id: 'a1', name: 'Lift', site: 'Tower A'),
    ];

    final List<PmJobRow> rows = parseJobs(workOrders, assets, '2026-08-04');

    // The done row is dropped; the other two keep their input order.
    expect(rows.map((PmJobRow r) => r.id).toList(), <String>['open', 'inprog']);
    expect(rows[0].status, PmJobStatus.open);
    expect(rows[1].status, PmJobStatus.inProgress);
  });

  test(
    'parseJobs over an empty catalogue yields an empty list (honest-empty)',
    () {
      expect(
        parseJobs(const <PmEnt>[], const <PmEnt>[], '2026-08-04'),
        isEmpty,
      );
    },
  );

  test('todayIso renders a zero-padded ISO date', () {
    expect(todayIso(DateTime(2026, 8, 4)), '2026-08-04');
    expect(todayIso(DateTime(2026, 12, 31)), '2026-12-31');
  });
}
