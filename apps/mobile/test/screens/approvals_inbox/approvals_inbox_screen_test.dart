// Widget tests for the mobile approvals inbox (route inbox).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// Most tests drive ApprovalsInboxScreen directly with a FAKE repo + inline
// i18n/strings (no network) and prove the REAL behaviours — the summary chips, the
// honest-omit gaps, the client filter, and honest-empty. The SEAM test proves that
// tapping a PR row pushes the real PrDetailScreenHost carrying the tapped doc's id
// (under an AppScope so the destination can build; a 404 Dio adapter keeps any
// destination fetch deterministic). Bounded pumps (never pumpAndSettle) are used so
// the destination's loading spinner does not stall the settle.
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/api/generated/juneflow_api_client.dart';
import 'package:juneflow_mobile/app/app_scope.dart';
import 'package:juneflow_mobile/app/app_services.dart';
import 'package:juneflow_mobile/app/gps_source.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/offline/offline.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_agg.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_repository.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_screen.dart';
import 'package:juneflow_mobile/screens/pr_detail/pr_detail_screen.dart';

/// In-memory repo: serves fixed inbox rows (no network).
class _FakeRepo implements ApprovalsInboxRepository {
  _FakeRepo(this.rows);
  final List<InboxEnt> rows;

  @override
  Future<List<InboxEnt>> list() async => rows;
}

/// th i18n where tp(key) echoes the key; dict resolves the inbox templates + ฿.
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"subcon.unitBaht":{"th":"฿"},'
  '"mob.approval.inbox.title":{"th":"กล่องอนุมัติ"},'
  '"mob.approval.inbox.cardAgeAgo":{"th":"{age} ที่แล้ว"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"sub":"รออนุมัติ","chipPending":"รออนุมัติ","chipUrgent":"ด่วน",'
  '"chipTotal":"มูลค่ารวม","filterAll":"ทั้งหมด","filterUrgent":"ด่วน",'
  '"unitMinute":"นาที","unitHour":"ชม.","unitDay":"วัน"}',
);

InboxEnt _row(String id, String kind, String docNo, num? amount) =>
    <String, Object?>{
      'id': id,
      'kind': kind,
      'doc_no': docNo,
      'title': null,
      'requester': null,
      'amount': amount,
      'currency_code': 'THB',
      'created_at': '2026-01-01T00:00:00.000Z',
      'urgent': null,
    };

List<InboxEnt> _mix() => <InboxEnt>[
  _row('pr-1', 'PR', 'PR-2026-0418', 902475),
  _row('po-1', 'PO', 'PO-2026-0291', 1357760),
  _row('wo-1', 'WO', 'WO-2026-0117', 2301000),
];

Future<void> _pump(WidgetTester tester, _FakeRepo repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ApprovalsInboxScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pump(); // resolve the fake list() future
  await tester.pump();
}

void main() {
  testWidgets('renders the chrome, chips and honest doc rows', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(_mix()));

    // Header (dict title) + chip labels.
    expect(find.text('กล่องอนุมัติ'), findsOneWidget);
    expect(find.text('มูลค่ารวม'), findsOneWidget);
    // Every doc no is the card's primary line (title is honest-omitted).
    expect(find.text('PR-2026-0418'), findsOneWidget);
    expect(find.text('PO-2026-0291'), findsOneWidget);
    expect(find.text('WO-2026-0117'), findsOneWidget);
    // SERVER amounts render verbatim with ฿.
    expect(find.text('902,475 ฿'), findsOneWidget);
    // The REAL age meta renders (exact number covered by the agg test).
    expect(find.textContaining('ที่แล้ว'), findsWidgets);
    // The kind badges carry the real codes (PR/PO/WO appear as pill + badge).
    expect(find.text('PO'), findsWidgets);
    expect(find.text('WO'), findsWidgets);
  });

  testWidgets('the urgent chip is an HONEST 0 (never the mock 2)', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(_mix()));
    // count chip = 3 (real), urgent chip = 0 (honest), total chip = 4.56M compact.
    expect(find.text('3'), findsWidgets); // the count chip value
    expect(find.text('0'), findsWidgets); // the honest urgent chip value
  });

  testWidgets('a null amount / doc_no renders honest em-dashes', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeRepo(<InboxEnt>[
        _row('pr-1', 'PR', 'PR-A', 100)
          ..['doc_no'] = null
          ..['amount'] = null,
      ]),
    );
    // Both the doc-no slot and the amount slot em-dash (no fabrication).
    expect(find.text('—'), findsWidgets);
  });

  testWidgets('honest-empty: no rows → a centered em-dash, no crash', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(const <InboxEnt>[]));
    expect(find.text('—'), findsOneWidget);
  });

  testWidgets('the client filter keeps only the picked kind', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(_mix()));

    await tester.tap(find.byKey(const ValueKey<String>('inboxFilter_pr')));
    await tester.pump();
    expect(find.text('PR-2026-0418'), findsOneWidget);
    expect(find.text('PO-2026-0291'), findsNothing);
    expect(find.text('WO-2026-0117'), findsNothing);
  });

  testWidgets('the urgent filter is honest-empty (no urgency wire)', (
    WidgetTester tester,
  ) async {
    await _pump(tester, _FakeRepo(_mix()));

    await tester.tap(find.byKey(const ValueKey<String>('inboxFilter_urgent')));
    await tester.pump();
    // No doc rows survive the urgent filter → the honest-empty em-dash.
    expect(find.text('PR-2026-0418'), findsNothing);
    expect(find.text('—'), findsOneWidget);
  });

  testWidgets('the SEAM: tapping a PR row pushes the PR detail with its id', (
    WidgetTester tester,
  ) async {
    await _pumpUnderScope(tester, _FakeRepo(_mix()));

    // The inbox rendered; nothing is pushed yet.
    expect(find.text('PR-2026-0418'), findsOneWidget);
    expect(find.byType(PrDetailScreenHost), findsNothing);

    // Tap the PR row (its doc no is unique to the PR card).
    await tester.tap(find.text('PR-2026-0418'));
    await tester.pump(); // fire the push
    await tester.pump(const Duration(milliseconds: 350)); // run the transition

    // The PR detail Host mounted carrying the REAL doc id + no (the approval seam).
    final Finder host = find.byType(PrDetailScreenHost);
    expect(host, findsOneWidget);
    final PrDetailScreenHost pushed = tester.widget<PrDetailScreenHost>(host);
    expect(pushed.prId, 'pr-1');
    expect(pushed.docNo, 'PR-2026-0418');

    // Drain the destination's (404) detail fetch so no timer outlives the tree.
    await tester.pump(const Duration(seconds: 1));
    await tester.pump();
  });

  testWidgets('a PO row is inert this wave (no push, no detail)', (
    WidgetTester tester,
  ) async {
    await _pumpUnderScope(tester, _FakeRepo(_mix()));
    await tester.tap(find.text('PO-2026-0291'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    // Still on the inbox — no PR-detail was pushed.
    expect(find.byType(PrDetailScreenHost), findsNothing);
    expect(find.text('PO-2026-0291'), findsOneWidget);
  });
}

/// Pumps the inbox under a real [AppScope] so a pushed [PrDetailScreenHost] can
/// resolve services when it builds. The Dio uses a 404 adapter so any destination
/// fetch is deterministic + offline; the inbox itself is driven by the fake repo.
Future<void> _pumpUnderScope(WidgetTester tester, _FakeRepo repo) async {
  final Dio dio = Dio()..httpClientAdapter = _Fake404Adapter();
  final AppServices services = AppServices(
    i18n: _i18n,
    shellStrings: _strings,
    dio: dio,
    api: JuneflowApiClient(dio),
    syncQueue: InMemorySyncQueue(),
    tokenProvider: () => null,
    // Inert const source — this inbox test never checks in, so it is never called.
    gpsSource: const GeolocatorGpsSource(),
  );
  await tester.pumpWidget(
    AppScope(
      services: services,
      child: MaterialApp(
        home: Scaffold(
          body: ApprovalsInboxScreen(
            repo: repo,
            strings: _strings,
            i18n: _i18n,
          ),
        ),
      ),
    ),
  );
  await tester.pump(); // resolve the fake list() future
  await tester.pump();
}

/// A Dio adapter that answers every request with a 404 — deterministic + offline,
/// so the pushed detail's GET /pr/:id resolves to an honest "no PR" state instead
/// of touching the network (which would hang the widget test's settle).
class _Fake404Adapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      '{"code":"NOT_FOUND"}',
      404,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
