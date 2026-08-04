// Pure unit tests for the approvals-inbox aggregator (parse + summary + kind
// counts + client filter + relative age + money formatting). No Flutter, no
// network — every derivation runs on plain wire maps, the same opaque shape GET
// /dashboard/approvals-inbox returns.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_agg.dart';

/// One inbox wire row in the real backend shape (dashboard.ts InboxRow): title,
/// requester and urgent are ALWAYS null (documented GAPs).
InboxEnt _row({
  required String id,
  required String kind,
  String? docNo,
  Object? amount,
  String? currency = 'THB',
  String? createdAt,
}) => <String, Object?>{
  'id': id,
  'kind': kind,
  'doc_no': docNo,
  'title': null,
  'requester': null,
  'amount': amount,
  'currency_code': currency,
  'created_at': createdAt,
  'urgent': null,
};

void main() {
  group('parseInbox', () {
    test('projects the real wire columns (never the null GAP fields)', () {
      final List<InboxRow> rows = parseInbox(<InboxEnt>[
        _row(
          id: 'pr-1',
          kind: 'PR',
          docNo: 'PR-2026-0418',
          amount: 902475,
          createdAt: '2026-01-01T00:00:00.000Z',
        ),
      ]);
      expect(rows.length, 1);
      final InboxRow r = rows.single;
      expect(r.id, 'pr-1');
      expect(r.kind, InboxKind.pr);
      expect(r.kindCode, 'PR');
      expect(r.docNo, 'PR-2026-0418');
      expect(r.amount, 902475);
      expect(r.currencyCode, 'THB');
      expect(r.createdAt, isNotNull);
      expect(r.isTappable, isTrue); // a PR opens the detail (the seam)
    });

    test('PO/PO/WO kinds parse; PO/WO are not tappable this wave', () {
      final List<InboxRow> rows = parseInbox(<InboxEnt>[
        _row(id: 'po-1', kind: 'PO', docNo: 'PO-1', amount: 1000),
        _row(id: 'wo-1', kind: 'WO', docNo: 'WO-1', amount: 2000),
      ]);
      expect(rows[0].kind, InboxKind.po);
      expect(rows[0].isTappable, isFalse);
      expect(rows[1].kind, InboxKind.wo);
      expect(rows[1].isTappable, isFalse);
    });

    test('a null amount / doc_no stays null (the view em-dashes them)', () {
      final InboxRow r = parseInbox(<InboxEnt>[
        _row(id: 'pr-2', kind: 'PR', docNo: null, amount: null, currency: null),
      ]).single;
      expect(r.docNo, isNull);
      expect(r.amount, isNull);
      expect(r.currencyCode, isNull);
    });

    test('a row with no id is dropped (nothing honest to navigate to)', () {
      final List<InboxRow> rows = parseInbox(<InboxEnt>[
        <String, Object?>{'kind': 'PR', 'doc_no': 'PR-X'},
      ]);
      expect(rows, isEmpty);
    });

    test('server row order is preserved (already newest-first)', () {
      final List<InboxRow> rows = parseInbox(<InboxEnt>[
        _row(id: 'a', kind: 'PR'),
        _row(id: 'b', kind: 'PO'),
        _row(id: 'c', kind: 'WO'),
      ]);
      expect(rows.map((InboxRow r) => r.id).toList(), <String>['a', 'b', 'c']);
    });

    test('an unknown kind falls back to other (never guessed)', () {
      final InboxRow r = parseInbox(<InboxEnt>[
        _row(id: 'x', kind: 'INVOICE'),
      ]).single;
      expect(r.kind, InboxKind.other);
      expect(r.kindCode, 'INVOICE');
      expect(r.isTappable, isFalse);
    });
  });

  group('summarize', () {
    test('count = length, total = Σ amount, urgent = HONEST 0', () {
      final List<InboxRow> rows = parseInbox(<InboxEnt>[
        _row(id: 'a', kind: 'PR', amount: 100),
        _row(id: 'b', kind: 'PO', amount: 250),
        _row(id: 'c', kind: 'WO', amount: null), // null contributes 0
      ]);
      final InboxSummary s = summarize(rows);
      expect(s.count, 3);
      expect(s.totalAmount, 350);
      expect(s.urgentCount, 0); // never the mock's fabricated "2"
    });

    test('empty list → zeros', () {
      final InboxSummary s = summarize(const <InboxRow>[]);
      expect(s.count, 0);
      expect(s.totalAmount, 0);
      expect(s.urgentCount, 0);
    });
  });

  group('kindCounts', () {
    test('counts each real kind; all = length; urgent = 0', () {
      final List<InboxRow> rows = parseInbox(<InboxEnt>[
        _row(id: 'a', kind: 'PR'),
        _row(id: 'b', kind: 'PR'),
        _row(id: 'c', kind: 'PO'),
        _row(id: 'd', kind: 'WO'),
      ]);
      final InboxKindCounts c = kindCounts(rows);
      expect(c.all, 4);
      expect(c.pr, 2);
      expect(c.po, 1);
      expect(c.wo, 1);
      expect(c.urgent, 0);
    });
  });

  group('applyFilter', () {
    final List<InboxRow> rows = parseInbox(<InboxEnt>[
      _row(id: 'a', kind: 'PR'),
      _row(id: 'b', kind: 'PO'),
      _row(id: 'c', kind: 'WO'),
    ]);

    test('all keeps everything', () {
      expect(applyFilter(rows, InboxFilter.all).length, 3);
    });
    test('a kind filter keeps only that kind', () {
      expect(
        applyFilter(rows, InboxFilter.pr).map((InboxRow r) => r.id),
        <String>['a'],
      );
      expect(
        applyFilter(rows, InboxFilter.po).map((InboxRow r) => r.id),
        <String>['b'],
      );
      expect(
        applyFilter(rows, InboxFilter.wo).map((InboxRow r) => r.id),
        <String>['c'],
      );
    });
    test('urgent yields honest-empty (no urgency wire)', () {
      expect(applyFilter(rows, InboxFilter.urgent), isEmpty);
    });
  });

  group('relativeAge', () {
    final DateTime base = DateTime.utc(2026, 1, 1, 12);

    test('minutes under an hour', () {
      final AgeParts a = relativeAge(
        base,
        base.add(const Duration(minutes: 5)),
      );
      expect(a.value, 5);
      expect(a.unit, AgeUnit.minute);
    });
    test('whole hours under a day', () {
      final AgeParts a = relativeAge(
        base,
        base.add(const Duration(hours: 2, minutes: 30)),
      );
      expect(a.value, 2);
      expect(a.unit, AgeUnit.hour);
    });
    test('whole days at a day or more', () {
      final AgeParts a = relativeAge(base, base.add(const Duration(days: 3)));
      expect(a.value, 3);
      expect(a.unit, AgeUnit.day);
    });
    test('a future timestamp clamps to 0 minutes (never negative)', () {
      final AgeParts a = relativeAge(
        base,
        base.subtract(const Duration(minutes: 10)),
      );
      expect(a.value, 0);
      expect(a.unit, AgeUnit.minute);
    });
  });

  group('formatMoney', () {
    test('groups with thousands separators, no decimals', () {
      expect(formatMoney(902475), '902,475');
      expect(formatMoney(0), '0');
      expect(formatMoney(1000), '1,000');
    });
    test('rounds, keeps the sign, non-finite → "0"', () {
      expect(formatMoney(168.5), '169');
      expect(formatMoney(-2301000), '-2,301,000');
      expect(formatMoney(double.nan), '0');
    });
  });

  group('compactMoney (matches the prototype chip "6.84M")', () {
    test('millions render as trimmed M', () {
      expect(compactMoney(6840000), '6.84M');
      expect(compactMoney(6800000), '6.8M');
      expect(compactMoney(7000000), '7M');
      expect(compactMoney(1500000), '1.5M');
    });
    test('sub-million stays a grouped integer', () {
      expect(compactMoney(902475), '902,475');
      expect(compactMoney(0), '0');
    });
    test('non-finite → "0"', () {
      expect(compactMoney(double.infinity), '0');
    });
  });
}
