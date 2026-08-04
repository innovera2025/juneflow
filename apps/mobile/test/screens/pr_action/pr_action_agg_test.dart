// Pure unit tests for the PR action-sheet aggregator (parse + formatMoney +
// template split). No Flutter, no network — every derivation is exercised on
// plain wire maps, the same opaque shape GET /pr/{id} returns.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/pr_action/pr_action_agg.dart';

void main() {
  group('parsePrDetail', () {
    test(
      'projects the real wire columns (no / amount / status / itemCount)',
      () {
        final PrDetail? d = parsePrDetail(<String, Object?>{
          'id': 'pr-1',
          'no': 'PR-2026-0418',
          'status': 'pending',
          'currency_code': 'THB',
          'amount': 902475,
          'items': <Object?>[
            <String, Object?>{'id': 'i1'},
            <String, Object?>{'id': 'i2'},
          ],
        });
        expect(d, isNotNull);
        expect(d!.id, 'pr-1');
        expect(d.no, 'PR-2026-0418');
        expect(d.status, 'pending');
        expect(d.currencyCode, 'THB');
        expect(d.amount, 902475);
        expect(d.itemCount, 2);
        expect(d.isPending, isTrue);
      },
    );

    test('null wire → null (honest "no PR", never a fabricated doc)', () {
      expect(parsePrDetail(null), isNull);
    });

    test('a row with no id → null (nothing honest to act on)', () {
      expect(parsePrDetail(<String, Object?>{'no': 'PR-X'}), isNull);
    });

    test(
      'missing no → null field (view renders an em-dash); amount defaults 0',
      () {
        final PrDetail? d = parsePrDetail(<String, Object?>{'id': 'pr-2'});
        expect(d!.no, isNull);
        expect(d.amount, 0);
        expect(d.itemCount, 0);
        expect(d.isPending, isFalse);
      },
    );

    test('amount arrives as a double or numeric string', () {
      expect(
        parsePrDetail(<String, Object?>{'id': 'a', 'amount': 12.5})!.amount,
        12.5,
      );
      expect(
        parsePrDetail(<String, Object?>{'id': 'b', 'amount': '340'})!.amount,
        340,
      );
    });
  });

  group('formatMoney (parity with web pr-rows formatMoney)', () {
    test('groups with thousands separators, no decimals', () {
      expect(formatMoney(902475), '902,475');
      expect(formatMoney(1268000), '1,268,000');
      expect(formatMoney(0), '0');
      expect(formatMoney(340), '340');
      expect(formatMoney(1000), '1,000');
    });

    test('rounds and keeps the sign; non-finite → "0"', () {
      expect(formatMoney(168.5), '169'); // round
      expect(formatMoney(-2301000), '-2,301,000');
      expect(formatMoney(double.nan), '0');
      expect(formatMoney(double.infinity), '0');
    });
  });

  group('splitTemplate', () {
    test('splits a mid-sentence template around its {no}/{amount} slots', () {
      final List<TemplateSeg> segs = splitTemplate(
        'ต้องการอนุมัติเอกสาร {no} มูลค่า {amount} หรือไม่?',
        <String>{'no', 'amount'},
      );
      // literal, no, literal, amount, literal
      expect(segs.length, 5);
      expect(segs[0].isToken, isFalse);
      expect(segs[1].token, 'no');
      expect(segs[2].isToken, isFalse);
      expect(segs[3].token, 'amount');
      expect(segs[4].isToken, isFalse);
    });

    test('a leading token yields no empty literal before it', () {
      final List<TemplateSeg> segs = splitTemplate('{no} rest', <String>{'no'});
      expect(segs.first.token, 'no');
      expect(segs.last.text, ' rest');
    });

    test('an unknown token is kept as literal, not dropped', () {
      final List<TemplateSeg> segs = splitTemplate('a {x} b', <String>{'no'});
      expect(segs.length, 1);
      expect(segs.single.text, 'a {x} b');
    });
  });
}
