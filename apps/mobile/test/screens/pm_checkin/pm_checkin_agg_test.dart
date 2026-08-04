// Unit tests for the mobile PM check-in derivations (route pm-checkin).
//
// Pure logic only — no Flutter, no i18n, no Dio. Proves the honest state machine
// (confirmed / queued / failed) reads the drain outcome correctly (report-first,
// queue-fallback), the time formatter, and the em-dash-first service-info parse.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_agg.dart';

SyncOperation _op(String id, SyncOpStatus status) => SyncOperation(
  id: id,
  entityType: 'pm_checkin',
  kind: SyncOpKind.create,
  endpoint: '/pm/workorders/$id/checkin',
  method: 'POST',
  payload: const <String, Object?>{'gps': null},
  createdAt: DateTime.utc(2026, 8, 4, 9),
  status: status,
);

DrainReport _report(String id, SyncOutcome outcome) =>
    DrainReport(<SyncAttempt>[SyncAttempt(id: id, outcome: outcome)]);

void main() {
  group('resolveCheckinState — report is authoritative', () {
    test('synced -> confirmed', () {
      expect(
        resolveCheckinState('a', _report('a', SyncOutcome.synced), const []),
        PmCheckinState.confirmed,
      );
    });

    test('permanentlyFailed -> failed', () {
      expect(
        resolveCheckinState(
          'a',
          _report('a', SyncOutcome.permanentlyFailed),
          const [],
        ),
        PmCheckinState.failed,
      );
    });

    test('deferred -> queued (never confirmed)', () {
      expect(
        resolveCheckinState('a', _report('a', SyncOutcome.deferred), const []),
        PmCheckinState.queued,
      );
    });
  });

  group('resolveCheckinState — queue fallback (op not in the report)', () {
    const DrainReport empty = DrainReport(<SyncAttempt>[]);

    test('op gone from the queue -> confirmed (synced + removed)', () {
      expect(
        resolveCheckinState('a', empty, const <SyncOperation>[]),
        PmCheckinState.confirmed,
      );
    });

    test('op still pending in the queue -> queued', () {
      expect(
        resolveCheckinState('a', empty, <SyncOperation>[
          _op('a', SyncOpStatus.pending),
        ]),
        PmCheckinState.queued,
      );
    });

    test('op failed in the queue -> failed', () {
      expect(
        resolveCheckinState('a', empty, <SyncOperation>[
          _op('a', SyncOpStatus.failed),
        ]),
        PmCheckinState.failed,
      );
    });
  });

  group('formatCheckinTime', () {
    test('zero-pads to HH:mm', () {
      expect(formatCheckinTime(DateTime(2026, 8, 4, 9, 4)), '09:04');
      expect(formatCheckinTime(DateTime(2026, 8, 4, 18, 30)), '18:30');
      expect(formatCheckinTime(DateTime(2026, 8, 4, 0, 0)), '00:00');
    });
  });

  group('deriveServiceInfo — em-dash first', () {
    test('a null wire yields all-null (the view em-dashes every field)', () {
      final PmServiceInfo info = deriveServiceInfo(null);
      expect(info.zone, isNull);
      expect(info.sla, isNull);
      expect(info.contract, isNull);
    });

    test('the real WO wire (no zone/SLA/contract columns) stays all-null', () {
      // pm.ts workOrderWire — none of the service-info columns exist.
      final PmServiceInfo info = deriveServiceInfo(<String, Object?>{
        'id': 'w1',
        'asset_id': 'a1',
        'checkin_gps': '',
        'items': const <Object?>[],
      });
      expect(info.zone, isNull);
      expect(info.sla, isNull);
      expect(info.contract, isNull);
    });

    test(
      'a future wire that grows the columns lights them up (never invented)',
      () {
        final PmServiceInfo info = deriveServiceInfo(<String, Object?>{
          'service_zone': 'North BKK',
          'sla_response': '24h',
          'contract_no': 'MT-2569-018',
        });
        expect(info.zone, 'North BKK');
        expect(info.sla, '24h');
        expect(info.contract, 'MT-2569-018');
      },
    );
  });
}
