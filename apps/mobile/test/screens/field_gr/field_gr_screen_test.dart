// Widget tests for the mobile site goods-receipt review (route field-gr).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven with a FAKE repository + inline i18n/strings, so nothing
// touches the network.
//
// These assert the RENDERED tree — every expectation is a `find.text` over the
// real widgets — so a screen that stopped displaying its wired data would fail
// here even if field_gr_agg still computed it correctly.
//
// Three claims get their own tests because they are what this screen must never
// make: it must not print a 0 where a quantity is absent; it must not render the
// QC checklist, the photo gallery or either footer button (each would assert
// something no column can back); and it must not put a money value on screen.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/field_gr/field_gr_agg.dart';
import 'package:juneflow_mobile/screens/field_gr/field_gr_repository.dart';
import 'package:juneflow_mobile/screens/field_gr/field_gr_screen.dart';

/// A fake repo returning canned receipts + anchor documents. [grThrows] /
/// [anchorThrows] simulate each read failing on its own.
class _FakeRepo implements FieldGrRepository {
  _FakeRepo({
    this.grs = const <FieldGrEnt>[],
    this.pos = const <FieldGrEnt>[],
    this.wos = const <FieldGrEnt>[],
    this.grThrows = false,
    this.anchorThrows = false,
  });

  final List<FieldGrEnt> grs;
  final List<FieldGrEnt> pos;
  final List<FieldGrEnt> wos;
  final bool grThrows;
  final bool anchorThrows;

  int grReads = 0;

  @override
  Future<List<FieldGrEnt>> listGrs() async {
    grReads++;
    if (grThrows) throw Exception('offline');
    return grs;
  }

  @override
  Future<List<FieldGrEnt>> listPos() async {
    if (anchorThrows) throw Exception('offline');
    return pos;
  }

  @override
  Future<List<FieldGrEnt>> listWos() async {
    if (anchorThrows) throw Exception('offline');
    return wos;
  }
}

/// th i18n with just the keys the screen references (dict values copied verbatim
/// from docs/extract/i18n-full.json; the phrase key IS the Thai text).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "po.list.receiveGoods": {"th":"รับสินค้า"},
    "gr.list.receivedItems": {"th":"รายการที่รับ"}
  },
  "nav_i18n": {},
  "phrases": {"ผู้ขาย": {"th":"ผู้ขาย"}},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape (see field_gr_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "po.list.receiveGoods",
  "vendorLabel": "ผู้ขาย",
  "receivedItems": "gr.list.receivedItems"
}
''');

FieldGrEnt _item({
  String id = 'gi-1',
  Object? name,
  Object? orderedQty,
  Object? receivedQty,
  Object? unit,
}) => <String, Object?>{
  'id': id,
  'name': name,
  'ordered_qty': orderedQty,
  'received_qty': receivedQty,
  'unit': unit,
  'price': 138.5,
  'currency_code': 'THB',
};

/// The prototype's own three lines (L379-383), as real wire rows.
final List<FieldGrEnt> _prototypeLines = <FieldGrEnt>[
  _item(
    id: 'gi-1',
    name: 'ปูน 50kg',
    orderedQty: 1200,
    receivedQty: 1200,
    unit: 'ถุง',
  ),
  _item(
    id: 'gi-2',
    name: 'เหล็ก SR24 12mm',
    orderedQty: 540,
    receivedQty: 540,
    unit: 'เส้น',
  ),
  _item(
    id: 'gi-3',
    name: 'เหล็ก SD40 16mm',
    orderedQty: 320,
    receivedQty: 280,
    unit: 'เส้น',
  ),
];

FieldGrEnt _gr({
  String id = 'gr-1',
  String status = 'received',
  String? poId = 'po-1',
  Object? vendor = 'บจก. ซีแพคคอนกรีต',
  String date = '2026-05-28T03:00:00.000Z',
  List<FieldGrEnt>? items,
}) => <String, Object?>{
  'id': id,
  'no': 'GR-2026-0148',
  'po_id': poId,
  'wo_id': null,
  'status': status,
  'photos': <String>[],
  'vendor': vendor,
  'date': date,
  'money': 66480,
  'currency_code': 'THB',
  'items': items ?? _prototypeLines,
};

Future<void> _pump(WidgetTester tester, _FakeRepo repo, {String? grId}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: FieldGrScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          grId: grId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('the wired receipt', () {
    testWidgets('renders the title, anchor no, vendor and every line', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          grs: <FieldGrEnt>[_gr()],
          pos: <FieldGrEnt>[
            <String, Object?>{'id': 'po-1', 'no': 'PO-2026-0290'},
          ],
        ),
      );

      expect(find.text('รับสินค้า'), findsOneWidget); // title
      expect(find.text('PO-2026-0290'), findsOneWidget); // header eyebrow
      expect(find.text('ผู้ขาย'), findsOneWidget); // vendor label
      expect(find.text('บจก. ซีแพคคอนกรีต'), findsOneWidget); // vendor value
      expect(find.text('รายการที่รับ'), findsOneWidget); // section title

      // The names + units st-receive provably cannot show (B-265).
      expect(find.text('ปูน 50kg'), findsOneWidget);
      expect(find.text('เหล็ก SR24 12mm'), findsOneWidget);
      expect(find.text('เหล็ก SD40 16mm'), findsOneWidget);
    });

    testWidgets('renders the quantity pair with the real unit', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      expect(_richText(tester), contains('1,200 / 1,200 ถุง'));
      expect(_richText(tester), contains('540 / 540 เส้น'));
      expect(_richText(tester), contains('280 / 320 เส้น'));
    });

    testWidgets('a short line shows the signed shortfall, not the word', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      // The prototype's caption is a shortfall noun + "partial"; neither has an
      // honest key, so the number carries it (see field_gr_screen.dart).
      expect(find.text('-40 เส้น'), findsOneWidget);
      expect(find.text('partial'), findsNothing);
      expect(find.textContaining('ขาด'), findsNothing);
    });

    testWidgets('a WO-anchored receipt resolves its number from GET /wo', (
      WidgetTester tester,
    ) async {
      final FieldGrEnt gr = _gr(poId: null)..['wo_id'] = 'wo-7';
      await _pump(
        tester,
        _FakeRepo(
          grs: <FieldGrEnt>[gr],
          wos: <FieldGrEnt>[
            <String, Object?>{'id': 'wo-7', 'no': 'WO-2026-0117'},
          ],
        ),
      );
      expect(find.text('WO-2026-0117'), findsOneWidget);
    });
  });

  group('honest states — an absent value is an em-dash, NEVER a zero', () {
    testWidgets('an unresolved anchor em-dashes the eyebrow', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      expect(find.text('—'), findsWidgets);
      expect(find.text('po-1'), findsNothing); // never the raw uuid
    });

    testWidgets('an unresolved vendor em-dashes its value', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr(vendor: null)]));
      expect(find.text('ผู้ขาย'), findsOneWidget); // label is chrome, stays
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('a line with no quantities shows dashes, not 0', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          grs: <FieldGrEnt>[
            _gr(
              items: <FieldGrEnt>[_item(name: 'ปูน 50kg', unit: 'ถุง')],
            ),
          ],
        ),
      );
      final String text = _richText(tester);
      expect(text, contains('— / — ถุง'));
      expect(
        text,
        isNot(contains('0 / 0')),
        reason: 'a fabricated zero receipt is exactly what §0 rule 3 forbids',
      );
    });

    testWidgets('a line with no name shows a dash and keeps its quantities', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          grs: <FieldGrEnt>[
            _gr(
              items: <FieldGrEnt>[
                _item(orderedQty: 320, receivedQty: 280, unit: 'เส้น'),
              ],
            ),
          ],
        ),
      );
      expect(find.text('—'), findsWidgets);
      expect(_richText(tester), contains('280 / 320 เส้น'));
    });

    testWidgets('a receipt with no line detail renders honest-empty lines', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(grs: <FieldGrEnt>[_gr(items: <FieldGrEnt>[])]),
      );
      // The section still appears — the receipt exists — with a dash inside.
      expect(find.text('รายการที่รับ'), findsOneWidget);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('no receipt at all renders the empty state, not a blank card', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo());
      expect(find.text('รายการที่รับ'), findsNothing);
      expect(find.text('ผู้ขาย'), findsNothing);
      expect(find.text('—'), findsWidgets);
    });

    testWidgets('a failed read renders empty, never a half-built receipt', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grThrows: true));
      expect(find.text('รายการที่รับ'), findsNothing);
    });

    testWidgets('a failed anchor read keeps the vendor and the lines', (
      WidgetTester tester,
    ) async {
      // The eyebrow degrades alone — never the whole screen.
      await _pump(
        tester,
        _FakeRepo(grs: <FieldGrEnt>[_gr()], anchorThrows: true),
      );
      expect(find.text('บจก. ซีแพคคอนกรีต'), findsOneWidget);
      expect(find.text('ปูน 50kg'), findsOneWidget);
      expect(find.text('PO-2026-0290'), findsNothing);
    });

    testWidgets('a returned receipt is not shown on the bare tab route', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(grs: <FieldGrEnt>[_gr(status: 'returned')]),
      );
      expect(find.text('รายการที่รับ'), findsNothing);
    });
  });

  group('what this screen must NEVER render', () {
    testWidgets('no money value reaches the screen', (
      WidgetTester tester,
    ) async {
      // Both the line price and the receipt-level `money` are on the fed wire.
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      final String text = _richText(tester);
      expect(text, isNot(contains('138.5')));
      expect(text, isNot(contains('66480')));
      expect(text, isNot(contains('66,480')));
      expect(text, isNot(contains('฿')));
      expect(text, isNot(contains('THB')));
    });

    testWidgets('no QC checklist — there is no column to back one', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      expect(find.text('QC Checklist'), findsNothing);
      expect(find.text('ของถูกต้องตาม PO'), findsNothing);
      expect(find.text('สภาพไม่เสียหาย'), findsNothing);
      expect(find.text('บรรจุภัณฑ์ครบ'), findsNothing);
      expect(find.text('เอกสารใบส่งของแนบ'), findsNothing);
      // Four ticked boxes would assert an inspection that never happened.
      expect(find.byIcon(Icons.check), findsNothing);
    });

    testWidgets('no photo gallery — gr.photos is never populated', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      expect(find.text('รูปสินค้าที่รับ'), findsNothing);
      expect(find.byType(Image), findsNothing);
      expect(find.byIcon(Icons.add), findsNothing);
    });

    testWidgets('no footer buttons — one has no endpoint, one has no label', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      expect(find.text('เซ็นรับ GR'), findsNothing);
      expect(find.text('คืน/ปฏิเสธ'), findsNothing);
      expect(find.text('ปฏิเสธ'), findsNothing); // the misdescribing near-miss
      expect(find.text('คืนสินค้า'), findsNothing); // the KPI-id near-miss
      // No control on the screen can post anything.
      expect(find.byType(ElevatedButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
    });

    testWidgets('no delivery date and no delivery-note number', (
      WidgetTester tester,
    ) async {
      // grWire.date IS fed above (the RECEIPT date). Printing it under the
      // prototype's "delivered on" label would be a semantic fabrication, and the
      // delivery-note number has no column at all.
      await _pump(tester, _FakeRepo(grs: <FieldGrEnt>[_gr()]));
      final String text = _richText(tester);
      expect(text, isNot(contains('2026-05-28')));
      expect(text, isNot(contains('DO-')));
      expect(find.textContaining('ส่งของ'), findsNothing);
      expect(find.textContaining('ใบส่ง'), findsNothing);
      // The GR's own number is not the delivery note either.
      expect(find.text('GR-2026-0148'), findsNothing);
    });
  });

  group('the push seam', () {
    testWidgets('a pushed id shows exactly that receipt', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          grs: <FieldGrEnt>[
            _gr(id: 'gr-1', vendor: 'A', items: <FieldGrEnt>[]),
            _gr(id: 'gr-2', vendor: 'B', items: <FieldGrEnt>[]),
          ],
        ),
        grId: 'gr-2',
      );
      expect(find.text('B'), findsOneWidget);
      expect(find.text('A'), findsNothing);
    });

    testWidgets('a stale pushed id renders empty, never another receipt', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          grs: <FieldGrEnt>[_gr(id: 'gr-1', vendor: 'A')],
        ),
        grId: 'gr-gone',
      );
      expect(find.text('A'), findsNothing);
      expect(find.text('รายการที่รับ'), findsNothing);
    });

    testWidgets(
      'WITHHELD: a pushed id for a returned receipt renders empty, never its items',
      (WidgetTester tester) async {
        // The visible consequence of the eligibility rule, and the reason it is
        // enforced on the pushed-id route too: this screen has NO status pill, so
        // a returned receipt drawn here would put real goods under the heading
        // "items received" with nothing on screen to say they went back.
        await _pump(
          tester,
          _FakeRepo(
            grs: <FieldGrEnt>[
              _gr(
                id: 'gr-r',
                status: 'returned',
                vendor: 'บจก. ซีแพคคอนกรีต',
                items: _prototypeLines,
              ),
            ],
          ),
          grId: 'gr-r',
        );
        expect(find.text('รายการที่รับ'), findsNothing);
        expect(find.text('บจก. ซีแพคคอนกรีต'), findsNothing);
        expect(find.text('ปูน 50kg'), findsNothing);
      },
    );

    testWidgets('the screen reads once on mount', (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(grs: <FieldGrEnt>[_gr()]);
      await _pump(tester, repo);
      expect(repo.grReads, 1);
    });
  });
}

/// Every character currently on screen, including RichText spans (the quantity
/// pair is a single Text.rich, so `find.text` alone cannot see it).
String _richText(WidgetTester tester) {
  final StringBuffer out = StringBuffer();
  for (final Element e in find.byType(RichText).evaluate()) {
    out.write((e.widget as RichText).text.toPlainText());
    out.write('\n');
  }
  return out.toString();
}
