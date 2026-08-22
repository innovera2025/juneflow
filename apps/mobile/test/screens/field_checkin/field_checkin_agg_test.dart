// Unit tests for the field-checkin derivation (B-437, gate G3).
//
// Expected values come from the SERVER's own rules — labor.ts findWorkerByUserId /
// optCoordPair / the (worker_id, day, idempotency_key) lookup — and from
// pototype/mobile-screens.jsx MFieldCheckin, not from the implementation.
//
// The properties worth protecting: the screen must offer a button ONLY when the
// server would accept it, the check-in key must be recoverable without storage, and
// a half-read GPS fix must become "no coordinate" rather than one field.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/field_checkin/field_checkin_agg.dart';

WireRow worker({String id = 'w-1', String? userId = 'u-1', bool active = true}) =>
    <String, Object?>{
      'id': id,
      'name': 'Somsak',
      'skill': 'Site Engineer',
      'team': 'A',
      'user_id': userId,
      'active': active,
    };

WireRow att({
  String id = 'a-1',
  String workerId = 'w-1',
  String day = '2026-08-23',
  String? inAt,
  String? outAt,
}) => <String, Object?>{
  'id': id,
  'worker_id': workerId,
  'day': day,
  'checked_in_at': inAt,
  'checked_out_at': outAt,
};

void main() {
  group('resolving which worker the caller is', () {
    test('matches the row whose user_id is the caller', () {
      final CheckinWorker? w = findSelfWorker(<WireRow>[worker()], 'u-1');
      expect(w, isNotNull);
      expect(w!.id, 'w-1');
      expect(w.skill, 'Site Engineer');
    });

    test('finds nobody when no row carries a user_id — the current seed (B-438)', () {
      // Measured on the live stack: 8 workers, 0 with a user_id. The screen must
      // reach the honest "no linked worker" state rather than pick a row.
      expect(findSelfWorker(<WireRow>[worker(userId: null)], 'u-1'), isNull);
    });

    test('never falls back to someone else when the caller has no row', () {
      expect(findSelfWorker(<WireRow>[worker(userId: 'someone-else')], 'u-1'), isNull);
    });

    test('finds nobody for an absent caller id', () {
      expect(findSelfWorker(<WireRow>[worker()], null), isNull);
      expect(findSelfWorker(<WireRow>[worker()], ''), isNull);
    });
  });

  group('reading the caller id out of GET /me', () {
    test('reads the nested user id the endpoint actually returns', () {
      expect(
        callerUserId(<String, Object?>{
          'user': <String, Object?>{'id': 'u-9'},
        }),
        'u-9',
      );
    });

    test('is null for an empty or unexpected payload', () {
      expect(callerUserId(null), isNull);
      expect(callerUserId(<String, Object?>{}), isNull);
    });
  });

  group('which action the screen offers', () {
    test('withholds both buttons when no worker row is linked', () {
      expect(nextAction(null, null), CheckinAction.noWorker);
    });

    test('withholds both buttons for a worker off the roster', () {
      // The server 403s an inactive worker; offering the button would guarantee a
      // failure the user cannot act on.
      final CheckinWorker w = findSelfWorker(<WireRow>[worker(active: false)], 'u-1')!;
      expect(nextAction(w, null), CheckinAction.inactive);
    });

    test('offers check-in when today has no row', () {
      final CheckinWorker w = findSelfWorker(<WireRow>[worker()], 'u-1')!;
      expect(nextAction(w, null), CheckinAction.checkIn);
    });

    test('offers check-out once checked in', () {
      final CheckinWorker w = findSelfWorker(<WireRow>[worker()], 'u-1')!;
      final CheckinDay? d = findToday(
        <WireRow>[att(inAt: '2026-08-23T01:00:00Z')],
        'w-1',
        '2026-08-23',
      );
      expect(nextAction(w, d), CheckinAction.checkOut);
    });

    test('offers neither once the day is closed', () {
      final CheckinWorker w = findSelfWorker(<WireRow>[worker()], 'u-1')!;
      final CheckinDay? d = findToday(
        <WireRow>[att(inAt: '2026-08-23T01:00:00Z', outAt: '2026-08-23T10:00:00Z')],
        'w-1',
        '2026-08-23',
      );
      expect(nextAction(w, d), CheckinAction.done);
    });
  });

  group("finding today's row in the whole-tenant register", () {
    test('matches on BOTH worker and day', () {
      // GET /labor/attendance ignores the contract's filter param (B-435), so the
      // register arrives whole and a match on day alone would show someone else's.
      final List<WireRow> register = <WireRow>[
        att(id: 'other-worker', workerId: 'w-2', inAt: '2026-08-23T01:00:00Z'),
        att(id: 'other-day', day: '2026-08-22', inAt: '2026-08-22T01:00:00Z'),
        att(id: 'mine', inAt: '2026-08-23T02:00:00Z'),
      ];
      expect(findToday(register, 'w-1', '2026-08-23')!.id, 'mine');
    });

    test('is null when the register holds nothing for that worker-day', () {
      expect(findToday(<WireRow>[att(workerId: 'w-2')], 'w-1', '2026-08-23'), isNull);
    });
  });

  group('the idempotency key', () {
    test('is derivable from the worker and the day, with no stored state', () {
      // The checkout finds the row by (worker_id, day, idempotency_key) and the key
      // is NOT on the attendance wire, so a random key could not close a day after
      // an app restart.
      expect(checkinKey('w-1', '2026-08-23'), 'checkin:w-1:2026-08-23');
      expect(checkinKey('w-1', '2026-08-23'), checkinKey('w-1', '2026-08-23'));
    });

    test('differs per worker and per day', () {
      expect(checkinKey('w-1', '2026-08-23') == checkinKey('w-2', '2026-08-23'), isFalse);
      expect(checkinKey('w-1', '2026-08-23') == checkinKey('w-1', '2026-08-24'), isFalse);
    });
  });

  group('the GPS fix', () {
    test('splits a real fix into the pair the endpoint takes', () {
      final ({double lat, double lng})? f = splitFix('13.756331, 100.501765');
      expect(f, isNotNull);
      expect(f!.lat, closeTo(13.756331, 1e-9));
      expect(f.lng, closeTo(100.501765, 1e-9));
    });

    test('yields NOTHING for an absent or unparseable fix, never one field', () {
      // labor.ts optCoordPair 400s a present-but-unparseable coordinate and refuses
      // a half pair, so anything short of two real numbers must send neither.
      expect(splitFix(null), isNull);
      expect(splitFix(''), isNull);
      expect(splitFix('13.75'), isNull);
      expect(splitFix('abc, def'), isNull);
      expect(splitFix('13.75, '), isNull);
    });
  });

  group('display helpers', () {
    test('renders the stored instant as a clock time, not the mock 08:00', () {
      expect(clockOf(DateTime.utc(2026, 8, 23, 1, 5).toIso8601String()),
          matches(RegExp(r'^\d{2}:\d{2}$')));
    });

    test('has no time at all when nothing is stored', () {
      expect(clockOf(null), isNull);
      expect(clockOf('not-a-date'), isNull);
    });

    test('stamps the day in the format the endpoint parses', () {
      expect(dayOf(DateTime(2026, 1, 5)), '2026-01-05');
    });
  });
}
