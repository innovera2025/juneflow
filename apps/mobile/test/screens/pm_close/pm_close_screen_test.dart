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
// Three claims get their own tests because they are what this screen must never
// make:
//   * nothing renders a certificate/report claim in ANY state (this screen's CTA is
//     labelled pm.closeWithSignBtn, so the word sits one line away from the LINE
//     promise the prototype attaches to it);
//   * the signature box reflects the STORED column and cannot be flipped by tapping
//     — B-331 made the pad REAL, which is exactly why that case now needs pinning
//     from BOTH sides: drawing must work, and a bare tap must still not close a
//     work order;
//   * an EMPTY pad cannot submit, and what a signed pad submits is `{signature}`
//     alone — never cause/fix/advice, which would blank pm-notes' maintenance log.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_agg.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_repository.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_screen.dart';
import 'package:juneflow_mobile/screens/pm_close/signature_ink.dart';
import 'package:juneflow_mobile/screens/pm_close/signature_pad.dart';

/// A fake repo returning canned work orders + assets, and RECORDING every close it
/// is asked to make. [woThrows] / [assetThrows] simulate each read failing on its
/// own; [outcome] drives what the drain reports back.
class _FakeRepo implements PmCloseRepository {
  _FakeRepo({
    this.workOrders = const <PmCloseEnt>[],
    this.assets = const <PmCloseEnt>[],
    this.woThrows = false,
    this.assetThrows = false,
    this.outcome = SyncOutcome.synced,
  });

  final List<PmCloseEnt> workOrders;
  final List<PmCloseEnt> assets;
  final bool woThrows;
  final bool assetThrows;

  /// What the drain says happened to the submitted op.
  SyncOutcome outcome;

  int woReads = 0;
  int assetReads = 0;

  /// Every close body this repo was asked to send, in order. Assertions are on the
  /// BODY — the request itself, not the fact that a method was called.
  final List<Map<String, Object?>> submitted = <Map<String, Object?>>[];

  /// The op ids used, so a retry can be shown to REUSE one rather than stack a
  /// second write behind the first.
  final List<String> opIds = <String>[];

  /// The ops still due, mirroring what the real queue would hold after [outcome].
  final List<SyncOperation> _due = <SyncOperation>[];

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

  @override
  Future<DrainReport> submitClose({
    required String workOrderId,
    required String opId,
    required Map<String, Object?> body,
    required DateTime now,
  }) async {
    submitted.add(body);
    opIds.add(opId);
    return _report(opId);
  }

  @override
  Future<DrainReport> drain() async =>
      _report(opIds.isEmpty ? 'none' : opIds.last);

  @override
  Future<List<SyncOperation>> due() async => _due;

  DrainReport _report(String opId) {
    _due.clear();
    if (outcome != SyncOutcome.synced) {
      _due.add(
        SyncOperation(
          id: opId,
          entityType: 'pm_close',
          kind: SyncOpKind.update,
          endpoint: '/pm/workorders/wo-1/close',
          method: 'POST',
          payload: const <String, Object?>{},
          createdAt: DateTime.now(),
          status: outcome == SyncOutcome.permanentlyFailed
              ? SyncOpStatus.failed
              : SyncOpStatus.pending,
        ),
      );
    }
    return DrainReport(<SyncAttempt>[SyncAttempt(id: opId, outcome: outcome)]);
  }
}

/// Draw a real signature on the pad: pen-down, several MOVES, pen-up.
///
/// Anything short of a move is a tap, and a tap deliberately does not count
/// (SignatureInk.hasSignature) — so this helper is what a genuine capture looks
/// like, and `tester.tap` is what an accidental brush looks like.
Future<void> _sign(WidgetTester tester) async {
  final Offset origin = tester.getCenter(find.byType(SignaturePad));
  final TestGesture g = await tester.startGesture(origin - const Offset(60, 0));
  for (int i = 1; i <= 6; i++) {
    await g.moveBy(Offset(20, i.isEven ? 12 : -12));
  }
  await g.up();
  await tester.pumpAndSettle();
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
    "pm.closeWithSignBtn": {"th":"ปิดงาน + ลายเซ็น"},
    "pm.closedNote": {"th":"ปิดงานแล้ว · ลูกค้าลงนามรับงาน"},
    "tax.etax.statusPending": {"th":"รอส่ง"},
    "admin.common.actionFailedToast": {"th":"ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง"}
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
  "close": "pm.closeWithSignBtn",
  "closed": "pm.closedNote",
  "queued": "tax.etax.statusPending",
  "failed": "admin.common.actionFailedToast"
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

    testWidgets('customer_sign absent -> the live capture pad', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]));
      expect(find.byType(SignaturePad), findsOneWidget);
      expect(find.byIcon(Icons.draw_outlined), findsOneWidget);
      expect(find.byIcon(Icons.check), findsOneWidget); // the CTA's icon only
    });

    testWidgets('an already-signed work order shows NO pad — it is read-only', (
      WidgetTester tester,
    ) async {
      // A stored signature is the CUSTOMER's, and this screen offers no way to
      // overwrite one. Rendering a live pad over it would invite exactly that.
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[_wo('wo-1', customerSign: 'sig-blob')],
        ),
      );
      expect(find.byType(SignaturePad), findsNothing);
    });

    testWidgets(
      'stored STROKE JSON is re-rendered as real ink — no check-icon fallback',
      (WidgetTester tester) async {
        final String stored = encodeSignatureInk(
          const SignatureInk(
            width: 300,
            height: 110,
            strokes: <List<SignaturePoint>>[
              <SignaturePoint>[SignaturePoint(10, 10), SignaturePoint(60, 40)],
            ],
          ),
        )!;
        await _pump(
          tester,
          _FakeRepo(
            workOrders: <PmCloseEnt>[_wo('wo-1', customerSign: stored)],
          ),
        );
        // Only the CTA's check remains: the box now draws the signature itself
        // rather than standing in for it with an icon.
        expect(find.byIcon(Icons.check), findsOneWidget);
        expect(find.byIcon(Icons.draw_outlined), findsNothing);
        // …and the raw blob is never printed at the user.
        expect(find.textContaining('"v":1'), findsNothing);
      },
    );

    testWidgets('TAPPING the pad draws a dot but CANNOT close the work order', (
      WidgetTester tester,
    ) async {
      // The prototype flips a local `signed` flag on tap and paints a hardcoded
      // cursive name (mobile-pm.jsx L206-207). The pad is real now, so the guard
      // moved rather than disappeared: a tap is a single-point stroke, which
      // SignatureInk.hasSignature refuses, so an accidental brush against the pad
      // can never mark a work order as signed by the customer.
      final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
      await _pump(tester, repo);

      await tester.tap(find.byType(SignaturePad));
      await tester.pumpAndSettle();

      await tester.tap(find.text('ปิดงาน + ลายเซ็น'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(repo.submitted, isEmpty);
      expect(find.text('ปิดงาน + ลายเซ็น'), findsOneWidget);
    });
  });

  group('the screen never claims a close, a certificate or a report', () {
    testWidgets('an EMPTY pad genuinely cannot close — no handler, no request', (
      WidgetTester tester,
    ) async {
      // B-288 pinned this as "the CTA is permanently disabled". B-331 made the
      // control real, so what is pinned now is the CONDITION: with nothing on the
      // pad the body would be empty, the handler would write nothing at all
      // (`Object.keys(set).length > 0` is false, pm.ts L796) and still answer 200 —
      // the fabricated outcome B-288 refused to ship.
      final _FakeRepo repo = _FakeRepo(
        workOrders: <PmCloseEnt>[
          _wo('wo-1', items: <Object?>[_line('a', 'normal')]),
        ],
      );
      await _pump(tester, repo);

      expect(find.text('ปิดงาน + ลายเซ็น'), findsOneWidget);
      // Disabled has to MEAN disabled: the bar's GestureDetector must carry a NULL
      // onTap, so there is nothing to fire even if something dispatched to it.
      final GestureDetector bar = tester.widget<GestureDetector>(
        find
            .ancestor(
              of: find.text('ปิดงาน + ลายเซ็น'),
              matching: find.byType(GestureDetector),
            )
            .first,
      );
      expect(bar.onTap, isNull);

      // Tapping it issues no request.
      await tester.tap(find.text('ปิดงาน + ลายเซ็น'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(repo.submitted, isEmpty);
      expect(find.text('ปิดงาน + ลายเซ็น'), findsOneWidget);
    });

    testWidgets(
      'a stroke the OS tore off is not a signature — pointer CANCEL discards it',
      (WidgetTester tester) async {
        // B-357/F5. onPointerCancel used to call _up(), which COMMITTED the torn
        // stroke: a notification-shade pull or an incoming call during a swipe became
        // a signature stroke, satisfied hasSignature and lit the CTA. The web pad has
        // always discarded it ("a half-stroke the pad tore off itself is not a mark
        // they made"), and the two clients may not disagree about one event.
        //
        // The gesture below is the SAME travel _sign() makes — the only difference is
        // that the OS takes the pointer instead of the customer lifting it.
        final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
        await _pump(tester, repo);

        final Offset origin = tester.getCenter(find.byType(SignaturePad));
        final TestGesture g = await tester.startGesture(
          origin - const Offset(60, 0),
        );
        for (int i = 1; i <= 6; i++) {
          await g.moveBy(Offset(20, i.isEven ? 12 : -12));
        }
        await g.cancel();
        await tester.pumpAndSettle();

        // Back to the EMPTY-pad case: a null onTap, and nothing sent.
        final GestureDetector bar = tester.widget<GestureDetector>(
          find
              .ancestor(
                of: find.text('ปิดงาน + ลายเซ็น'),
                matching: find.byType(GestureDetector),
              )
              .first,
        );
        expect(bar.onTap, isNull);
        await tester.tap(find.text('ปิดงาน + ลายเซ็น'), warnIfMissed: false);
        await tester.pumpAndSettle();
        expect(repo.submitted, isEmpty);
      },
    );

    testWidgets(
      'a cancel AFTER a finished stroke keeps the finished one (B-357/F5)',
      (WidgetTester tester) async {
        // The other half of the rule: cancel drops the OPEN stroke only. A signature
        // already completed is the customer's mark and survives an interruption that
        // arrives afterwards — otherwise the fix would trade one lost signature for
        // another.
        final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
        await _pump(tester, repo);
        await _sign(tester);

        final Offset origin = tester.getCenter(find.byType(SignaturePad));
        final TestGesture g = await tester.startGesture(origin);
        await g.cancel();
        await tester.pumpAndSettle();

        await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
        await tester.pumpAndSettle();
        expect(repo.submitted, hasLength(1));
        expect(repo.submitted.single['signature'], isNotNull);
      },
    );

    testWidgets('the prototype success view never appears, signed or not', (
      WidgetTester tester,
    ) async {
      // mobile-pm.jsx L185-194: a full-screen "ปิดงาน PM สำเร็จ" over "the PM
      // certificate was sent to the customer over LINE". There is no certificate
      // column and LINE is a no-op stub, so neither may render — and a stored
      // signature (which the merged deriveStatus reads as "done") must not be
      // enough to make the screen announce one.
      //
      // 'ปิดงานแล้ว' is included deliberately: pm.closedNote became a LEGITIMATE
      // label under B-331, but only AFTER the server accepts a write made in this
      // session. Merely LOADING a signed work order must not print it, or the
      // screen would be reporting an outcome it did not observe.
      //
      // THE THIRD VALUE IS WHAT MAKES THAT SENTENCE TESTABLE, and its absence is the
      // hole this test shipped with. The other two cannot reach the signed branch at
      // all: null is unsigned, and 'sig-blob' is a LEGACY opaque value that
      // decodeSignatureInk returns null for — so under BOTH of them `_stored` stays
      // null and a label keyed off stored ink is never exercised. "signed or not" in
      // the name was therefore a condition this fixture could not create. The third
      // value is real, decodable stroke JSON: a work order that ARRIVES already
      // signed, `_stored` non-null, ink on the screen, and still no close announced
      // because `_state` is idle and nothing was observed.
      //
      // GENERATED THROUGH THE ENCODER, never pasted. A frozen literal stops being
      // able to fail the moment the encoding moves — it would keep decoding to null
      // under a new `v` and quietly become a second 'sig-blob'.
      final String storedInk = encodeSignatureInk(
        const SignatureInk(
          width: 300,
          height: 110,
          strokes: <List<SignaturePoint>>[
            <SignaturePoint>[SignaturePoint(10, 10), SignaturePoint(60, 40)],
          ],
        ),
      )!;
      for (final String? sign in <String?>[null, 'sig-blob', storedInk]) {
        // A FRESH MOUNT PER ARM, and the read count below proves it happened.
        // pumpWidget REUSES the State when runtimeType and key match, and this
        // screen reads the work order exactly once, from initState (there is no
        // didUpdateWidget). Pumping the next repo into the live tree therefore
        // leaves the FIRST arm's screen mounted and asserts it three times — a loop
        // over three fixtures that silently tests one. Unmounting first is what
        // makes the next arm actually load.
        await tester.pumpWidget(const SizedBox.shrink());
        final _FakeRepo repo = _FakeRepo(
          workOrders: <PmCloseEnt>[_wo('wo-1', customerSign: sign)],
        );
        await _pump(tester, repo);
        expect(
          repo.woReads,
          1,
          reason:
              'sign=$sign never reached the screen — the arm tested nothing',
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

  group('the close actually happens (B-331)', () {
    testWidgets('a signed pad sends {signature} — and NOTHING else', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
      await _pump(tester, repo);
      await _sign(tester);
      await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
      await tester.pumpAndSettle();

      expect(repo.submitted, hasLength(1));
      final Map<String, Object?> body = repo.submitted.single;
      // The KEY SET is the assertion. cause/fix/advice belong to pm-notes and were
      // saved there; the handler keys off key PRESENCE, so including any of them
      // here would blank a maintenance log this screen never showed the user.
      expect(body.keys.toSet(), <String>{'signature'});

      // …and the value is real, re-renderable stroke JSON — not a flag, not a name.
      final SignatureInk ink = decodeSignatureInk(
        body['signature']! as String,
      )!;
      expect(ink.hasSignature, isTrue);
      expect(ink.width, greaterThan(0));
      expect(ink.height, greaterThan(0));
    });

    testWidgets('on acceptance the bar reports CLOSED and the ink is shown', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]));
      await _sign(tester);
      await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
      await tester.pumpAndSettle();

      // pm.closedNote — "closed · the customer signed for the work" — is true only
      // now, which is precisely why it could not be used before B-331.
      expect(find.text('ปิดงานแล้ว · ลูกค้าลงนามรับงาน'), findsOneWidget);
      // The pad is replaced by the accepted signature: it is stored data now.
      expect(find.byType(SignaturePad), findsNothing);
      // The prototype's success takeover is still not shown.
      expect(find.textContaining('สำเร็จ'), findsNothing);
      expect(find.textContaining('LINE'), findsNothing);
    });

    testWidgets('a DEFERRED drain says pending — never closed', (
      WidgetTester tester,
    ) async {
      // Offline / 5xx: the write is captured durably but NOTHING is stored server
      // side yet. Reporting a close here would be the fabricated outcome, one step
      // removed.
      await _pump(
        tester,
        _FakeRepo(
          workOrders: <PmCloseEnt>[_wo('wo-1')],
          outcome: SyncOutcome.deferred,
        ),
      );
      await _sign(tester);
      await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
      await tester.pumpAndSettle();

      expect(find.text('รอส่ง'), findsOneWidget);
      expect(find.textContaining('ปิดงานแล้ว'), findsNothing);
    });

    testWidgets('a 4xx says failed, and a retry REUSES the same op id', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(
        workOrders: <PmCloseEnt>[_wo('wo-1')],
        outcome: SyncOutcome.permanentlyFailed,
      );
      await _pump(tester, repo);
      await _sign(tester);
      await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
      await tester.pumpAndSettle();
      expect(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'), findsOneWidget);

      // Re-tapping must replay the SAME write, not stack a second one behind it.
      await tester.tap(find.text('ทำรายการไม่สำเร็จ · ลองใหม่อีกครั้ง'));
      await tester.pumpAndSettle();
      expect(repo.submitted, hasLength(2));
      expect(repo.opIds.toSet(), hasLength(1));
    });

    testWidgets('clearing the pad withdraws the ability to close', (
      WidgetTester tester,
    ) async {
      final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
      await _pump(tester, repo);
      await _sign(tester);

      // The icon-only clear (zero-mint: an icon needs no i18n key).
      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pumpAndSettle();

      await tester.tap(find.text('ปิดงาน + ลายเซ็น'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(repo.submitted, isEmpty);
    });

    testWidgets('a ROTATION mid-signature sends ink that matches the viewport it is labelled '
        'with (B-357/F6)', (WidgetTester tester) async {
      // The scenario: the technician signs, the phone rotates while it is handed to
      // the customer, the customer finishes. The pad records ONE w/h. Before this
      // fix it simply RELABELLED the viewport, so the pre-rotation stroke stayed in
      // the old coordinate space while `w` claimed the new one — arithmetically
      // valid, and the picture came back at the wrong scale and offset.
      final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await _pump(tester, repo);
      final double wide = tester.getSize(find.byType(SignaturePad)).width;
      await _sign(tester);

      // Rotate: the pad gets narrower (its height is fixed at the prototype's 110).
      await tester.binding.setSurfaceSize(const Size(360, 900));
      await tester.pumpAndSettle();
      final double narrow = tester.getSize(find.byType(SignaturePad)).width;
      expect(
        narrow,
        lessThan(wide),
        reason: 'the fixture must actually resize',
      );

      await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
      await tester.pumpAndSettle();

      final SignatureInk sent = decodeSignatureInk(
        repo.submitted.single['signature']! as String,
      )!;

      // The viewport describes the box the points are NOW in…
      expect(sent.width, closeTo(narrow, 0.05));
      // …and every point is inside it. Pre-fix, the stroke kept coordinates measured
      // across the WIDE pad while `w` said `narrow`, so this is where it failed: x
      // ran past the right edge of the viewport it was labelled with.
      for (final List<SignaturePoint> stroke in sent.strokes) {
        for (final SignaturePoint p in stroke) {
          expect(p.x, inInclusiveRange(0, sent.width + 0.05));
          expect(p.y, inInclusiveRange(0, sent.height + 0.05));
        }
      }
      // And it is still a signature: the rescale preserved the mark rather than
      // collapsing it.
      expect(sent.hasSignature, isTrue);
    });

    testWidgets(
      'a COMPACT signature survives a narrowing that used to unsign it (B-357/F4)',
      (WidgetTester tester) async {
        // The rescale is asymmetric — the pad's height is fixed, so min(w/cw, h/ch)
        // shrinks the ink when the box narrows and never grows it back. A small but
        // real signature therefore fell UNDER kSignatureMinStrokeSpan after a rotation
        // to portrait, and the CTA it had already lit went quiet: the customer's mark
        // was on the pad, visibly, and the screen refused to send it.
        final _FakeRepo repo = _FakeRepo(workOrders: <PmCloseEnt>[_wo('wo-1')]);
        addTearDown(() => tester.binding.setSurfaceSize(null));

        await _pump(tester, repo);
        final double wide = tester.getSize(find.byType(SignaturePad)).width;

        // ~12.5 px of travel: comfortably a mark, and small enough that a narrowing
        // puts it under the guard.
        final Offset origin = tester.getCenter(find.byType(SignaturePad));
        final TestGesture g = await tester.startGesture(origin);
        await g.moveBy(const Offset(7.5, 10));
        await g.up();
        await tester.pumpAndSettle();

        // It is a signature BEFORE the resize.
        GestureDetector bar() => tester.widget<GestureDetector>(
          find
              .ancestor(
                of: find.text('ปิดงาน + ลายเซ็น'),
                matching: find.byType(GestureDetector),
              )
              .first,
        );
        expect(bar().onTap, isNotNull);

        await tester.binding.setSurfaceSize(const Size(360, 900));
        await tester.pumpAndSettle();
        final double narrow = tester.getSize(find.byType(SignaturePad)).width;
        expect(
          narrow,
          lessThan(wide),
          reason: 'the fixture must actually resize',
        );

        // …and it still is.
        expect(bar().onTap, isNotNull);
        await tester.tap(find.text('ปิดงาน + ลายเซ็น'));
        await tester.pumpAndSettle();
        expect(repo.submitted, hasLength(1));

        final SignatureInk sent = decodeSignatureInk(
          repo.submitted.single['signature']! as String,
        )!;
        // The condition that used to refuse it: measured in the space it is STORED in,
        // the mark is now under the threshold. It passes on provenance, not on luck.
        final SignaturePoint a = sent.strokes.single.first;
        final SignaturePoint b = sent.strokes.single.last;
        final double dx = b.x - a.x;
        final double dy = b.y - a.y;
        expect(
          dx * dx + dy * dy,
          lessThan(kSignatureMinStrokeSpan * kSignatureMinStrokeSpan),
          reason: 'the fixture must actually push the mark under the guard',
        );
        expect(
          sent.hasSignature,
          isFalse,
          reason: 'stored ink carries no provenance',
        );
      },
    );
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
