// Pure unit tests for the PR-detail aggregator (parse + status derivation + money
// / qty formatting + the line-count VAT-clause drop). No Flutter, no network —
// every derivation runs on plain wire maps, the same opaque shape GET /pr/:id
// returns (pr.ts prWire + prItemWire).
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/pr_detail/pr_detail_agg.dart';

void main() {
  group('parsePrDetailView', () {
    test('projects the real wire columns + resolved parties + lines', () {
      final PrDetailView? d = parsePrDetailView(
        <String, Object?>{
          'id': 'pr-1',
          'no': 'PR-2026-0418',
          'title': 'ปูนซีเมนต์ + เหล็กเส้น',
          'status': 'pending',
          'approval_step': 2,
          'currency_code': 'THB',
          'amount': 902475,
          'project_id':
              'proj-uuid', // a uuid → resolved via the names map below
          'phase': 'เฟส 2 · B',
          'need_date': '2026-06-02',
          'vendor': 'CPAC',
          'requester': 'Wipha',
          'items': <Object?>[
            <String, Object?>{'id': 'l1', 'qty': 1200, 'amount': 202200},
            <String, Object?>{'id': 'l2', 'qty': 540, 'amount': 229500},
          ],
        },
        projectNames: <String, String>{'proj-uuid': 'Ratchaphruek'},
      );
      expect(d, isNotNull);
      expect(d!.id, 'pr-1');
      expect(d.no, 'PR-2026-0418');
      expect(d.title, 'ปูนซีเมนต์ + เหล็กเส้น'); // REAL wire column
      expect(d.status, PrStatus.pending);
      expect(d.currencyCode, 'THB');
      expect(d.amount, 902475);
      expect(d.vendor, 'CPAC');
      expect(d.requester, 'Wipha');
      expect(d.phase, 'เฟส 2 · B'); // REAL wire column
      expect(d.needDate, '2/6/2026'); // formatted from need_date
      expect(d.project, 'Ratchaphruek'); // resolved via the GET /projects join
      expect(d.itemCount, 2);
      // Line qty + amount are REAL; the material name is NOT on the wire → null.
      expect(d.items[0].qty, 1200);
      expect(d.items[0].amount, 202200);
      expect(d.items[0].name, isNull);
    });

    test(
      'an unresolved project_id → null name (honest em-dash, never the raw uuid)',
      () {
        // project_id present but not in the names catalogue → null (no uuid shown).
        final PrDetailView d = parsePrDetailView(<String, Object?>{
          'id': 'pr-1',
          'project_id': 'proj-uuid',
          'phase': 'เฟส 3',
        })!;
        expect(d.project, isNull);
        expect(d.phase, 'เฟส 3'); // phase is still REAL from the wire
      },
    );

    test(
      'a null vendor / requester / need_date stays null (view em-dashes)',
      () {
        final PrDetailView d = parsePrDetailView(<String, Object?>{
          'id': 'pr-2',
          'vendor': null,
          'requester': null,
        })!;
        expect(d.vendor, isNull);
        expect(d.requester, isNull);
        expect(d.no, isNull);
        expect(d.title, isNull);
        expect(d.needDate, isNull);
        expect(d.amount, 0);
        expect(d.itemCount, 0);
      },
    );

    test('null wire → null; a row with no id → null', () {
      expect(parsePrDetailView(null), isNull);
      expect(parsePrDetailView(<String, Object?>{'no': 'PR-X'}), isNull);
    });

    test('status maps every real code, else unknown (banner omitted)', () {
      PrStatus statusOf(String s) =>
          parsePrDetailView(<String, Object?>{'id': 'x', 'status': s})!.status;
      expect(statusOf('draft'), PrStatus.draft);
      expect(statusOf('pending'), PrStatus.pending);
      expect(statusOf('approved'), PrStatus.approved);
      expect(statusOf('rejected'), PrStatus.rejected);
      expect(statusOf('weird'), PrStatus.unknown);
    });
  });

  group('project-name join + phase line', () {
    test('buildProjectNames maps id → name; resolveProjectName joins it', () {
      final Map<String, String> names = buildProjectNames(<PrDetailEnt>[
        <String, Object?>{'id': 'p1', 'name': 'Ratchaphruek'},
        <String, Object?>{'id': 'p2', 'name': 'Bangna'},
        <String, Object?>{'id': '', 'name': 'skip'}, // no id → skipped
      ]);
      expect(names, <String, String>{'p1': 'Ratchaphruek', 'p2': 'Bangna'});
      expect(resolveProjectName('p2', names), 'Bangna');
      // Unresolved / empty → null (never the raw uuid).
      expect(resolveProjectName('nope', names), isNull);
      expect(resolveProjectName('', names), isNull);
    });

    test('projectLine composes "name · phase", or either alone, or null', () {
      expect(projectLine('Ratchaphruek', 'เฟส 2'), 'Ratchaphruek · เฟส 2');
      expect(projectLine('Ratchaphruek', null), 'Ratchaphruek');
      expect(projectLine(null, 'เฟส 2'), 'เฟส 2');
      expect(projectLine(null, null), isNull);
      expect(projectLine('', ''), isNull);
    });
  });

  group('formatWireDate', () {
    test('reformats YYYY-MM-DD to d/m/yyyy', () {
      expect(formatWireDate('2026-06-02'), '2/6/2026');
      expect(formatWireDate('2026-12-25'), '25/12/2026');
    });
    test('takes the date part of an ISO datetime (no timezone shift)', () {
      expect(formatWireDate('2026-06-02T00:00:00.000Z'), '2/6/2026');
    });
    test('null / empty / unparseable → null (view em-dashes)', () {
      expect(formatWireDate(null), isNull);
      expect(formatWireDate(''), isNull);
      expect(formatWireDate('not-a-date'), isNull);
    });
  });

  group('awaitingYouLead (pending status only — no tier number)', () {
    test('keeps the status clause before the middot, drops the tier tail', () {
      // PR approval is single-shot (pending is always step 0) → no "· tier N of M".
      expect(
        awaitingYouLead('รอคุณอนุมัติ · ชั้นที่ {level} จาก {total}'),
        'รอคุณอนุมัติ',
      );
    });
    test('robust across a (future) translated template', () {
      expect(
        awaitingYouLead('Awaiting your approval · tier {level} of {total}'),
        'Awaiting your approval',
      );
    });
  });

  group('formatMoney / formatQty', () {
    test('formatMoney groups + rounds (parity with pr-rows)', () {
      expect(formatMoney(902475), '902,475');
      expect(formatMoney(168.5), '169');
      expect(formatMoney(double.nan), '0');
    });
    test('formatQty groups whole qty, trims fractional', () {
      expect(formatQty(1200), '1,200');
      expect(formatQty(540), '540');
      expect(formatQty(1.5), '1.5');
      expect(formatQty(2.250), '2.25');
      expect(formatQty(double.infinity), '0');
    });
  });

  group('lineCountText (drops the "· รวม VAT" clause)', () {
    test('keeps only the count head, substitutes the real count', () {
      // The real dict template carries the VAT clause after a middot.
      expect(
        lineCountText('{count} รายการ · รวม VAT {vatPct}%', 4),
        '4 รายการ',
      );
    });
    test('works when the template has no VAT clause', () {
      expect(lineCountText('{count} รายการ', 2), '2 รายการ');
    });
  });
}
