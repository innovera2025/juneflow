// Widget tests for the mobile store awaiting-PO-receipt screen (route st-grlist).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
// The screen is driven directly with a FAKE repository + inline i18n/strings, so
// nothing touches the network; the assertions prove the REAL behaviours — the
// approved-only + vendor-joined list, honest em-dashes for the mock-only fields,
// honest-empty, and the receive-flow seam.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/screens/st_grlist/st_grlist_agg.dart';
import 'package:juneflow_mobile/screens/st_grlist/st_grlist_repository.dart';
import 'package:juneflow_mobile/screens/st_grlist/st_grlist_screen.dart';

/// In-memory repo: serves fixed PO + vendor pages, never the network.
class _FakeRepo implements StGrListRepository {
  _FakeRepo({required this.pos, required this.vendors});

  final List<StGrEnt> pos;
  final List<StGrEnt> vendors;

  @override
  Future<List<StGrEnt>> listPos() async => pos;

  @override
  Future<List<StGrEnt>> listVendors() async => vendors;
}

/// th i18n where tp(key) returns the key (renders the Thai sidecar text).
final JuneflowI18n _i18n = JuneflowI18n.fromJsonString(
  '{"langs":[{"code":"th","label":"ไทย","en":"Thai","dir":"ltr"}],'
  '"dict":{},"nav_i18n":{},"phrases":{}}',
  lang: 'th',
);

/// The screen's real key sidecar shape (values are the Thai phrase keys).
final ScreenStrings _strings = ScreenStrings.fromJsonString(
  '{"eyebrow":"สโตร์ไซต์","title":"รอรับของ (PO)","ctaReceive":"ตรวจนับ-รับของ"}',
);

const List<StGrEnt> _vendors = <StGrEnt>[
  <String, Object?>{'id': 'v1', 'name': 'บจก. ไทยสตีล'},
];

Future<void> _pump(
  WidgetTester tester,
  StGrListRepository repo, {
  void Function(StGrRow row)? onOpenReceive,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: StGrListScreen(
          repo: repo,
          strings: _strings,
          i18n: _i18n,
          onOpenReceive: onOpenReceive,
        ),
      ),
    ),
  );
  await tester.pump(); // resolve the fake listPos() future
  await tester.pump(); // resolve the fake listVendors() future
}

void main() {
  testWidgets('renders the header + only the approved PO, vendor-joined', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      pos: <StGrEnt>[
        <String, Object?>{
          'id': 'po1',
          'no': 'PO-2569-0388',
          'vendor_id': 'v1',
          'status': 'approved',
        },
        <String, Object?>{
          'id': 'po2',
          'no': 'PO-2569-0999',
          'vendor_id': 'v1',
          'status': 'draft', // not receivable → dropped
        },
      ],
      vendors: _vendors,
    );
    await _pump(tester, repo);

    // Header chrome (i18n keys resolve for th).
    expect(find.text('สโตร์ไซต์'), findsOneWidget);
    expect(find.text('รอรับของ (PO)'), findsOneWidget);

    // The approved PO's real number + real vendor name; the draft PO is absent.
    expect(find.text('PO-2569-0388'), findsOneWidget);
    expect(find.text('บจก. ไทยสตีล'), findsOneWidget);
    expect(find.text('PO-2569-0999'), findsNothing);

    // The count-and-receive affordance renders (once, for the one kept row).
    expect(find.text('ตรวจนับ-รับของ'), findsOneWidget);
  });

  testWidgets('the mock-only items line shows an honest em-dash (no wire)', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      pos: <StGrEnt>[
        <String, Object?>{
          'id': 'po1',
          'no': 'PO-1',
          'vendor_id': 'v1',
          'status': 'approved',
        },
      ],
      vendors: _vendors,
    );
    await _pump(tester, repo);
    // The items hero line is an em-dash (po.ts GAP 1 — no line-item wire).
    expect(find.text('—'), findsWidgets);
  });

  testWidgets(
    'an unresolved vendor shows an em-dash, never a fabricated name',
    (WidgetTester tester) async {
      final _FakeRepo repo = _FakeRepo(
        pos: <StGrEnt>[
          <String, Object?>{
            'id': 'po1',
            'no': 'PO-1',
            'vendor_id': 'ghost', // not in the vendors page
            'status': 'approved',
          },
        ],
        vendors: _vendors,
      );
      await _pump(tester, repo);
      expect(find.text('PO-1'), findsOneWidget);
      // Both the items line and the vendor line are em-dashes.
      expect(find.text('—'), findsNWidgets(2));
    },
  );

  testWidgets('honest-empty: no approved POs → a centered em-dash, no crash', (
    WidgetTester tester,
  ) async {
    final _FakeRepo repo = _FakeRepo(
      pos: <StGrEnt>[
        <String, Object?>{'id': 'po1', 'no': 'PO-1', 'status': 'pending'},
      ],
      vendors: _vendors,
    );
    await _pump(tester, repo);
    expect(find.text('—'), findsOneWidget);
    expect(find.text('PO-1'), findsNothing);
  });

  testWidgets('tapping a card opens the receive flow when a seam is wired', (
    WidgetTester tester,
  ) async {
    final List<String> opened = <String>[];
    final _FakeRepo repo = _FakeRepo(
      pos: <StGrEnt>[
        <String, Object?>{
          'id': 'po1',
          'no': 'PO-1',
          'vendor_id': 'v1',
          'status': 'approved',
        },
      ],
      vendors: _vendors,
    );
    await _pump(tester, repo, onOpenReceive: (StGrRow r) => opened.add(r.id));

    await tester.tap(find.text('PO-1'));
    await tester.pump();

    expect(opened, <String>['po1']);
  });
}
