// Widget tests for the mobile PM close summary (route pm-close).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard. The
// screen is driven with a FAKE repository + inline i18n/strings, so nothing touches
// the network.
//
// These assert the RENDERED screen, not helpers next to it: every expectation below
// is a `find.text` / `find.byIcon` over the real widget tree, so a screen that
// stopped displaying its wired data would fail here even if pm_close_agg still
// computed it correctly.
//
// Two claims get their own tests because they are what this screen must never make:
//   * nothing renders a close/certificate/report claim in ANY state (and unlike
//     pm-notes, that is NOT vacuous here — this screen's own CTA is labelled with
//     pm.closeWithSignBtn, so the word is one line away from appearing as an
//     ENABLED action; the test pins the button's disabled-ness, not the word);
//   * the signature box reflects the STORED column and cannot be flipped by tapping.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_agg.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_repository.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_screen.dart';

/// A fake repo returning canned work orders + assets. [woThrows] / [assetThrows]
/// simulate each read failing on its own.
class _FakeRepo implements PmCloseRepository {
  _FakeRepo({
    this.workOrders = const <PmCloseEnt>[],
    this.assets = const <PmCloseEnt>[],
    this.woThrows = false,
    this.assetThrows = false,
  });

  final List<PmCloseEnt> workOrders;
  final List<PmCloseEnt> assets;
  final bool woThrows;
  final bool assetThrows;

  int woReads = 0;
  int assetReads = 0;

  @override
  Future<List<PmCloseEnt>> listWorkOrders() async {
    woReads++;
    if (woThrows) throw Exception('offline');
    return workOrders;
  }

  @override
  Future<List<PmCloseEnt>> listAssets() async {
    assetReads++;
    if (assetThrows) throw Exception('offline');
    return assets;
  }
}

/// th i18n with just the keys the screen references (dict values copied verbatim
/// from docs/extract/i18n-full.json; phrase keys are the prototype text itself).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],
  "dict": {
    "pm.fieldAsset": {"th":"อุปกรณ์"},
    "pm.timeTotal": {"th":"รวมเวลา"},
    "pm.signatureLabel": {"th":"ลายเซ็นลูกค้า / ผู้ดูแลอาคาร"},
    "pm.checkProgress": {"th":"{n}/{count} รายการ"},
    "pm.closeWithSignBtn": {"th":"ปิดงาน + ลายเซ็น"}
  },
  "nav_i18n": {},
  "phrases": {},
  "phrase_patterns": []
}
''', lang: 'th');

/// The screen's real sidecar shape (mixed layers — see pm_close_strings.json).
final ScreenStrings _strings = ScreenStrings.fromJsonString('''
{
  "title": "สรุป + ปิดงาน",
  "summaryTitle": "สรุปงาน",
  "rowAsset": "pm.fieldAsset",
  "rowChecks": "ผลตรวจ",
  "checkProgress": "pm.checkProgress",
  "repairCount": "ซ่อม {n}",
  "rowTime": "เริ่ม-เสร็จ",
  "rowTotalTime": "pm.timeTotal",
  "rowParts": "อะไหล่",
  "signatureTitle": "pm.signatureLabel",
  "recipient": "ผู้รับบริการ",
  "close": "pm.closeWithSignBtn"
}
''', assetPath: 'test/inline');

PmCloseEnt _wo(
  String id, {
  String? assetId,
  Object? items,
  String? customerSign,
}) => <String, Object?>{
  'id': id,
  if (assetId != null) 'asset_id': assetId,
  if (items != null) 'items': items,
  if (customerSign != null) 'customer_sign': customerSign,
};

PmCloseEnt _asset(String id, {String? name, String? code}) => <String, Object?>{
  'id': id,
  if (name != null) 'name': name,
  if (code != null) 'code': code,
};

Map<String, Object?> _line(String label, [String? result]) => <String, Object?>{
  'label': label,
  if (result != null) 'result': result,
};

Future<void> _pump(
  WidgetTester tester,
  _FakeRepo repo, {
  String? workOrderId = 'wo-1',
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: PmCloseScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          workOrderId: workOrderId,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// The em-dash the screen prints for anything the wire does not carry.
const String _dash = '—';

void main() {
  group('chrome', () {
    testWidgets('renders the header, both card titles and all five row labels', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]));

      expect(find.text('สรุป + ปิดงาน'), findsOneWidget);
      expect(find.text('สรุปงาน'), findsOneWidget);
      // The five summary labels, in the prototype's order (mobile-pm.jsx L201).
      expect(find.text('อุปกรณ์'), findsOneWidget);
      expect(find.text('ผลตรวจ'), findsOneWidget);
      expect(find.text('เริ่ม-เสร็จ'), findsOneWidget);
      expect(find.text('รวมเวลา'), findsOneWidget);
      expect(find.text('อะไหล่'), findsOneWidget);
      expect(find.text('ลายเซ็นลูกค้า / ผู้ดูแลอาคาร'), findsOneWidget);
      // The eyebrow: pm_workorder stores no document number, so an em-dash — never
      // the uuid dressed up as one.
      expect(find.text(_dash), findsWidgets);
      expect(find.text('wo-1'), findsNothing);
    });
  });

  group('the wired summary rows', () {
    testWidgets('the asset row renders the joined name + code', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[_wo('wo-1', assetId: 'a1')],
          assets: <PmCloseEnt>[
            _asset('a1', name: 'ลิฟต์ MX-1000', code: 'LIFT-A01'),
          ],
        ),
      );
      expect(find.text('ลิฟต์ MX-1000 (LIFT-A01)'), findsOneWidget);
    });

    testWidgets('an asset row with only a code renders it bare, no "()"', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[_wo('wo-1', assetId: 'a1')],
          assets: <PmCloseEnt>[_asset('a1', code: 'LIFT-A01')],
        ),
      );
      expect(find.text('LIFT-A01'), findsOneWidget);
      expect(find.text('(LIFT-A01)'), findsNothing);
      expect(find.textContaining('null'), findsNothing);
    });

    testWidgets(
      'the checks row renders count + repair tail from the REAL items',
      (WidgetTester tester) async {
        await _pump(
          tester,
          _FakeRepo(
            workOrders: <PmCloseEnt>[
              _wo(
                'wo-1',
                items: <Object?>[
                  _line('a', 'normal'),
                  _line('b', 'normal'),
                  _line('c', 'adjust'),
                  _line('d', 'repair'),
                  _line('e', 'normal'),
                ],
              ),
            ],
          ),
        );
        // The prototype's own shape: "5/5 รายการ · ซ่อม 1" (mobile-pm.jsx L201).
        expect(find.text('5/5 รายการ · ซ่อม 1'), findsOneWidget);
      },
    );

    testWidgets('an unchecked line lowers the numerator, not the denominator', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[
            _wo(
              'wo-1',
              items: <Object?>[
                _line('a', 'normal'),
                _line('b'),
                _line('c', 'repair'),
              ],
            ),
          ],
        ),
      );
      expect(find.text('2/3 รายการ · ซ่อม 1'), findsOneWidget);
    });

    testWidgets('no repairs -> the tail is dropped, never printed as zero', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[
            _wo('wo-1', items: <Object?>[_line('a', 'normal')]),
          ],
        ),
      );
      expect(find.text('1/1 รายการ'), findsOneWidget);
      expect(find.textContaining('ซ่อม'), findsNothing);
    });

    testWidgets(
      'a work order with NO checklist lines em-dashes the row — never 0/0',
      (WidgetTester tester) async {
        // The aggregate-vs-per-element trap: 0/0 reads as a fully checked list.
        await _pump(
          tester,
          _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1', items: <Object?>[])]),
        );
        expect(find.textContaining('0/0'), findsNothing);
        expect(find.textContaining('รายการ'), findsNothing);
      },
    );

    testWidgets('the two time rows and the parts row are always em-dashed', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[
            <String, Object?>{
              'id': 'wo-1',
              'asset_id': 'a1',
              'items': <Object?>[_line('a', 'normal')],
              // Keys the wire does not actually carry — present here to prove the
              // screen does not opportunistically render them.
              'created_at': '2026-08-05T09:14:00Z',
              'updated_at': '2026-08-05T10:48:00Z',
              'parts': <Object?>[
                <String, Object?>{'label': 'p', 'qty': 1, 'price': 3200},
              ],
            },
          ],
          assets: <PmCloseEnt>[_asset('a1', name: 'Lift')],
        ),
      );
      // Four bare em-dash Texts: the header eyebrow (no document number) plus the
      // start-end, total-time and parts rows. The recipient caption is a single
      // "<label>: —" Text, so it is asserted separately just below.
      expect(find.text(_dash), findsNWidgets(4));
      expect(find.text('ผู้รับบริการ: —'), findsOneWidget);
      // No fabricated clock, duration or money anywhere on screen.
      expect(find.textContaining('09:14'), findsNothing);
      expect(find.textContaining('10:48'), findsNothing);
      expect(find.textContaining('3,200'), findsNothing);
      expect(find.textContaining('3200'), findsNothing);
      expect(find.textContaining('฿'), findsNothing);
    });

    testWidgets('a failed ASSET read still renders the checks + signature', (
      WidgetTester tester,
    ) async {
      // The asset read enriches one row; losing it must not cost the other facts.
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[
            _wo(
              'wo-1',
              assetId: 'a1',
              items: <Object?>[_line('a', 'repair')],
              customerSign: 'sig',
            ),
          ],
          assetThrows: true,
        ),
      );
      expect(find.text('1/1 รายการ · ซ่อม 1'), findsOneWidget);
      // TWO checks: the signed signature box + the (disabled) CTA's own icon.
      // Counting is load-bearing — the CTA alone would satisfy `findsWidgets`.
      expect(find.byIcon(Icons.check), findsNWidgets(2));
      expect(find.byIcon(Icons.draw_outlined), findsNothing);
    });
  });

  group('the signature box reads the STORED column', () {
    testWidgets('customer_sign set -> the signed state', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[_wo('wo-1', customerSign: 'sig-blob')],
        ),
      );
      // Signed renders the check, not the draw affordance. The count matters: the
      // disabled CTA carries a check of its own, so `findsWidgets` would pass even
      // with an empty signature box.
      expect(find.byIcon(Icons.draw_outlined), findsNothing);
      expect(find.byIcon(Icons.check), findsNWidgets(2)); // box + CTA
      // The opaque stored blob is never printed at the user.
      expect(find.textContaining('sig-blob'), findsNothing);
    });

    testWidgets('customer_sign absent -> unsigned, and TAPPING cannot change it', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]));
      expect(find.byIcon(Icons.draw_outlined), findsOneWidget);
      expect(find.byIcon(Icons.check), findsOneWidget); // the CTA's icon only

      // The prototype flips a local `signed` flag on tap and paints a cursive name
      // (mobile-pm.jsx L206-207). Capture is unbuilt (B-288), so the pad is inert:
      // a tap must not manufacture a signature the database does not have.
      await tester.tap(find.byIcon(Icons.draw_outlined));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.draw_outlined), findsOneWidget);
      expect(find.byIcon(Icons.check), findsOneWidget); // still just the CTA
    });
  });

  group('the screen never claims a close, a certificate or a report', () {
    testWidgets('the CTA is present but genuinely DISABLED — no tap handler', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        workOrders: <PmCloseEnt>[
          _wo('wo-1', items: <Object?>[_line('a', 'normal')]),
        ],
      );
      await _pump(tester, repo);

      expect(find.text('ปิดงาน + ลายเซ็น'), findsOneWidget);
      // Disabled has to MEAN disabled: no GestureDetector/InkWell wraps the label,
      // so there is nothing to fire. (The screen would otherwise be one `onTap:`
      // away from POSTing an empty body and calling the result a close.)
      expect(
        find.ancestor(
          of: find.text('ปิดงาน + ลายเซ็น'),
          matching: find.byType(GestureDetector),
        ),
        findsNothing,
      );
      expect(
        find.ancestor(
          of: find.text('ปิดงาน + ลายเซ็น'),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );

      // Tapping it does nothing at all — in particular it issues no request.
      final int woReads = repo.woReads;
      await tester.tap(find.text('ปิดงาน + ลายเซ็น'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(repo.woReads, woReads);
      expect(find.text('ปิดงาน + ลายเซ็น'), findsOneWidget);
    });

    testWidgets('the prototype success view never appears, signed or not', (
      WidgetTester tester,
    ) async {
      // mobile-pm.jsx L185-194: a full-screen "ปิดงาน PM สำเร็จ" over "the PM
      // certificate was sent to the customer over LINE". No status column, no
      // certificate column, and LINE is a no-op stub — so neither may render, and a
      // stored signature (which the merged deriveStatus reads as "done") must NOT
      // be enough to make the screen announce a closed job.
      for (final String? sign in <String?>[null, 'sig-blob']) {
        await _pump(
          tester,
          _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1', customerSign: sign)]),
        );
        for (final String claim in <String>[
          'สำเร็จ', // "succeeded"
          'ใบรับรอง', // "certificate"
          'LINE',
          'ส่งรายงาน', // "send report"
          'ปิดงานแล้ว', // "closed"
          'กลับรายการงาน', // the success view's back button
        ]) {
          expect(
            find.textContaining(claim),
            findsNothing,
            reason: 'sign=$sign renders "$claim" — nothing backs it',
          );
        }
      }
    });
  });

  group('honest-empty', () {
    testWidgets('no work order selected -> a bare em-dash, and NO action bar', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo();
      await _pump(tester, repo, workOrderId: null);

      // TWO em-dashes, and both are load-bearing: the header eyebrow (no document
      // number exists on pm_workorder) and the centred empty marker.
      expect(find.text(_dash), findsNWidgets(2));
      expect(find.text('สรุปงาน'), findsNothing);
      // Nothing was read, and the close affordance is not offered over nothing.
      expect(repo.woReads, 0);
      expect(find.text('ปิดงาน + ลายเซ็น'), findsNothing);
    });

    testWidgets(
      'an id absent from the page -> honest-empty, never an invented job',
      (WidgetTester tester) async {
        await _pump(
          tester,
          _FakeRepo(workOrders: <PmCloseEnt>[_wo('other')]),
          workOrderId: 'wo-missing',
        );
        expect(find.text('สรุปงาน'), findsNothing);
        expect(find.text(_dash), findsNWidgets(2)); // eyebrow + empty marker
        // The OTHER job's data must not stand in for the one that is missing.
        expect(find.text('ปิดงาน + ลายเซ็น'), findsNothing);
      },
    );

    testWidgets(
      'a failed work-order read -> honest-empty (unknown, not blank)',
      (WidgetTester tester) async {
        await _pump(tester, _FakeRepo(woThrows: true));
        expect(find.text('สรุปงาน'), findsNothing);
        expect(find.text(_dash), findsNWidgets(2)); // eyebrow + empty marker
        expect(find.text('ปิดงาน + ลายเซ็น'), findsNothing);
      },
    );
  });
}
