// Widget tests for the mobile Sales CRM screen (route sales-crm).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven directly with a FAKE repository + inline i18n/strings, so
// nothing touches the network; the assertions prove the REAL behaviours — honest
// derivation from the wire, real per-stage counts, client-side stage filtering,
// warmth badges from the real column, and honest-empty.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/sales_crm/sales_crm_agg.dart';
import 'package:juneflow_mobile/screens/sales_crm/sales_crm_repository.dart';
import 'package:juneflow_mobile/screens/sales_crm/sales_crm_screen.dart';

/// In-memory repo: serves fixed opaque wire rows.
class _FakeRepo implements SalesLeadsRepository {
  _FakeRepo(this.rows);

  final List<LeadEnt> rows;

  @override
  Future<List<LeadEnt>> list() async => rows;
}

/// th i18n. The DICT layer carries the real th labels so t(key) renders the label
/// (an empty dict would echo the key). The phrase title resolves via tp -> the key.
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{'
  '"sales.crm.stageLead":{"th":"Lead"},'
  '"sales.crm.stageVisit":{"th":"นัดชม"},'
  '"sales.crm.stageQuote":{"th":"ใบเสนอราคา"},'
  '"sales.crm.stageBooking":{"th":"จอง"},'
  '"sales.crm.stageContract":{"th":"สัญญา"},'
  '"sales.crm.hotHot":{"th":"🔥 ร้อน"},'
  '"sales.crm.hotWarm":{"th":"อุ่น"},'
  '"sales.crm.hotCold":{"th":"เย็น"},'
  '"sales.crm.emptyNoLead":{"th":"ไม่มี Lead"}'
  '},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

/// The screen's real key sidecar shape (dict stable keys + the phrase title key).
final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"title":"Pipeline ของฉัน",'
  '"stageLead":"sales.crm.stageLead","stageVisit":"sales.crm.stageVisit",'
  '"stageQuote":"sales.crm.stageQuote","stageBooking":"sales.crm.stageBooking",'
  '"stageContract":"sales.crm.stageContract",'
  '"warmthHot":"sales.crm.hotHot","warmthWarm":"sales.crm.hotWarm",'
  '"warmthCold":"sales.crm.hotCold","empty":"sales.crm.emptyNoLead"}',
);

Future<void> _pump(WidgetTester tester, SalesLeadsRepository repo) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SalesCrmScreen(repo: repo, strings: _strings, i18n: _i18n),
      ),
    ),
  );
  await tester.pump(); // resolve the fake list() future
  await tester.pump();
}

void main() {
  testWidgets('renders the header, the 5 stage chips with REAL counts, and the '
      'active-stage cards', (WidgetTester tester) async {
    final _FakeRepo repo = _FakeRepo(<LeadEnt>[
      <String, Object?>{
        'id': 'a',
        'name': 'คุณวีระชัย ใจกล้า',
        'interest': 'Block B · 3 ห้องนอน',
        'stage': 'lead',
        'warmth': 'hot',
        'note': 'พร้อมเงินสด',
      },
      <String, Object?>{
        'id': 'b',
        'name': 'B',
        'stage': 'lead',
        'warmth': 'warm',
      },
      <String, Object?>{
        'id': 'c',
        'name': 'C',
        'stage': 'visit',
        'warmth': 'warm',
      },
    ]);
    await _pump(tester, repo);

    // Header title (phrase key resolves to itself for th).
    expect(find.text('Pipeline ของฉัน'), findsOneWidget);

    // All 5 real funnel-stage chip labels render (dict labels).
    for (final String label in <String>[
      'Lead',
      'นัดชม',
      'ใบเสนอราคา',
      'จอง',
      'สัญญา',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'chip "$label" missing');
    }

    // REAL per-stage counts, not the mock 12/5/3/2/1: lead=2, visit=1, others 0.
    expect(find.text('2'), findsOneWidget); // lead chip badge
    expect(find.text('1'), findsOneWidget); // visit chip badge

    // Active stage defaults to lead → its 2 cards show, the visit card does not.
    expect(find.text('คุณวีระชัย ใจกล้า'), findsOneWidget);
    expect(find.text('Block B · 3 ห้องนอน'), findsOneWidget);
    expect(find.text('พร้อมเงินสด'), findsOneWidget);
    expect(find.text('C'), findsNothing);

    // Warmth badge from the real column (a hot lead + a warm lead in the lead stage).
    expect(find.text('🔥 ร้อน'), findsOneWidget);
    expect(find.text('อุ่น'), findsOneWidget);
  });

  testWidgets(
    'tapping a stage chip filters the list to that stage (client-side)',
    (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(<LeadEnt>[
        <String, Object?>{'id': 'a', 'name': 'LeadGuy', 'stage': 'lead'},
        <String, Object?>{'id': 'c', 'name': 'VisitGuy', 'stage': 'visit'},
      ]);
      await _pump(tester, repo);

      // Default (lead) shows LeadGuy only.
      expect(find.text('LeadGuy'), findsOneWidget);
      expect(find.text('VisitGuy'), findsNothing);

      // Tap the "นัดชม" (visit) chip → the list switches to the visit lead.
      await tester.tap(find.text('นัดชม'));
      await tester.pump();

      expect(find.text('VisitGuy'), findsOneWidget);
      expect(find.text('LeadGuy'), findsNothing);
    },
  );

  testWidgets(
    'a lead with no warmth shows no badge; blank name/interest em-dash',
    (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(<LeadEnt>[
        <String, Object?>{'id': 'bare', 'stage': 'lead'},
      ]);
      await _pump(tester, repo);

      // No warmth → no badge of any kind.
      expect(find.text('🔥 ร้อน'), findsNothing);
      expect(find.text('อุ่น'), findsNothing);
      expect(find.text('เย็น'), findsNothing);
      // Blank name + interest → em-dash (never a fabricated value).
      expect(find.text('—'), findsWidgets);
    },
  );

  testWidgets(
    'honest-empty: the active stage has no leads → the real "no lead" line',
    (WidgetTester tester) async {
      // Only a visit-stage lead exists; the default active stage (lead) is empty.
      final _FakeRepo repo = _FakeRepo(<LeadEnt>[
        <String, Object?>{'id': 'c', 'name': 'VisitGuy', 'stage': 'visit'},
      ]);
      await _pump(tester, repo);

      expect(find.text('ไม่มี Lead'), findsOneWidget);
      expect(find.text('VisitGuy'), findsNothing);
    },
  );

  testWidgets('an unknown-stage lead is never forced into a column', (
    WidgetTester tester,
  ) async {
    // The mock's "โอน"/transfer stage has no server enum value.
    final _FakeRepo repo = _FakeRepo(<LeadEnt>[
      <String, Object?>{'id': 'x', 'name': 'GhostStage', 'stage': 'transfer'},
    ]);
    await _pump(tester, repo);

    // Default lead stage is empty (the transfer row is in no column).
    expect(find.text('ไม่มี Lead'), findsOneWidget);
    expect(find.text('GhostStage'), findsNothing);
  });
}
