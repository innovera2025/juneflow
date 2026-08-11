// Tests for the mobile route table + router resolution (MOB-SHELL-00).
//
// Locks the 26-screen inventory (MOBILE_GROUPS / screen-map.md §3) into code and
// proves the router falls back to an honest placeholder for unbuilt routes.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/shell/mobile_routes.dart';
import 'package:juneflow_mobile/shell/mobile_screen_router.dart';
import 'package:juneflow_mobile/shell/mobile_sections.dart';
import 'package:juneflow_mobile/shell/screen_placeholder.dart';

// The 26 distinct screen ids, verbatim from MOBILE_GROUPS
// (pototype/mobile-preview.jsx:3-44).
const Set<String> _expectedRouteIds = <String>{
  'inbox', 'detail', 'approve', 'reject', 'notif', // approval
  'srv-new', 'srv-track', 'tech-jobs', 'tech-close', // service
  'pm-jobs', 'pm-checkin', 'pm-checklist', 'pm-notes', 'pm-close', // pm-eng
  'st-grlist', 'st-receive', 'fm-progress', 'fm-accept', // storefm
  'field-progress', 'field-gr', 'field-pr', 'field-stock', // field
  'field-checkin', 'field-hse', // safety
  'exec', 'sales-crm', // exec
};

void main() {
  test('the route table has exactly the 26 known screen ids', () {
    expect(kMobileRoutes.length, 26);
    expect(kMobileRouteIds, _expectedRouteIds);
  });

  test('route ids are unique', () {
    final List<String> ids = kMobileRoutes
        .map((MobileRoute r) => r.id)
        .toList();
    expect(ids.toSet().length, ids.length);
  });

  test('sections map as the prototype MTabBar active usage', () {
    expect(sectionForRoute('inbox'), MobileSection.approve);
    expect(sectionForRoute('notif'), MobileSection.approve);
    expect(sectionForRoute('pm-jobs'), MobileSection.field);
    expect(sectionForRoute('st-grlist'), MobileSection.field);
    expect(sectionForRoute('field-checkin'), MobileSection.field);
    expect(sectionForRoute('srv-track'), MobileSection.service);
    expect(sectionForRoute('tech-jobs'), MobileSection.service);
    expect(sectionForRoute('exec'), MobileSection.exec);
    expect(sectionForRoute('sales-crm'), MobileSection.exec);
  });

  test('an unknown route id has no section', () {
    expect(sectionForRoute('does-not-exist'), isNull);
  });

  test(
    'notif is the first registered screen; every built id is a known route',
    () {
      // feature/mobile-notif ports the first real screen.
      expect(kBuiltRouteIds, contains('notif'));
      expect(mobileScreenBuilders.containsKey('notif'), isTrue);
      // A builder is registered for exactly the built ids, and each is known.
      expect(mobileScreenBuilders.keys.toSet(), kBuiltRouteIds);
      for (final String id in kBuiltRouteIds) {
        expect(kMobileRouteIds, contains(id));
      }
    },
  );

  test('inbox is a built tab route (feature/mobile-inbox-detail)', () {
    // The approvals inbox is registered as a tab screen; its builder + built id
    // must stay in lockstep (the graft bug: a builder with no kBuiltRouteIds id
    // would break the keys==kBuiltRouteIds invariant above).
    expect(kBuiltRouteIds, contains('inbox'));
    expect(mobileScreenBuilders.containsKey('inbox'), isTrue);
    // `detail` is a PUSHED route (constructed at the inbox's push site), so it has
    // no tab builder and is NOT in the built set.
    expect(mobileScreenBuilders.containsKey('detail'), isFalse);
    expect(kBuiltRouteIds, isNot(contains('detail')));
    expect(kMobileRouteIds, contains('detail')); // still a known route
  });

  test('field-stock is a built FIELD tab route (feature/mobile-field-stock)', () {
    // The on-site material issue — the heaviest write on mobile (one transaction
    // cuts the stock ledger AND posts a Dr 1140 / Cr 5020 JV), which is why it
    // carries a B-312 idempotency key.
    expect(kBuiltRouteIds, contains('field-stock'));
    expect(mobileScreenBuilders.containsKey('field-stock'), isTrue);
    expect(sectionForRoute('field-stock'), MobileSection.field);
  });

  testWidgets('the router renders an honest placeholder for an unbuilt route', (
    WidgetTester tester,
  ) async {
    // The subject is DERIVED, not named. A hardcoded id rots the moment its screen
    // is ported: this test has already been rewritten four times (pm-checkin →
    // pm-notes → pm-close → tech-close), each time by the port that broke it, and
    // each rewrite was a red build someone had to diagnose first. Taking the first
    // route the app itself reports as unbuilt keeps the assertion about the
    // PLACEHOLDER, which is what it is for, instead of about one screen's status.
    final String unbuilt = kMobileRouteIds.firstWhere(
      (String id) => !kBuiltRouteIds.contains(id),
      orElse: () => '',
    );
    // When every route is built the placeholder path is genuinely unreachable and
    // this test has nothing left to prove — fail loudly rather than pass vacuously,
    // so whoever ports the last screen deletes it deliberately.
    expect(
      unbuilt,
      isNotEmpty,
      reason:
          'every route is built — delete this test and the ScreenPlaceholder path '
          'it guards, do not leave it passing on nothing',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) =>
              resolveMobileScreen(context, unbuilt),
        ),
      ),
    );
    expect(find.byType(ScreenPlaceholder), findsOneWidget);
    expect(find.text(unbuilt), findsOneWidget);
  });

  test(
    'pm-checkin is a built route in lockstep (feature/mobile-write-checkin)',
    () {
      // The first offline-write screen: a built tab route (honest-empty with no
      // selection) that pm-jobs also pushes with a real work-order id. Its builder +
      // built id must stay in lockstep (keys==kBuiltRouteIds, asserted above).
      expect(kBuiltRouteIds, contains('pm-checkin'));
      expect(mobileScreenBuilders.containsKey('pm-checkin'), isTrue);
      expect(kMobileRouteIds, contains('pm-checkin'));
    },
  );

  test(
    'pm-checklist is a built route in lockstep (feature/mobile-pm-checklist)',
    () {
      // The PM flow's second write screen: a built tab route (honest-empty with no
      // selection) that pm-checkin also pushes with a real work-order id. Its
      // builder + built id must stay in lockstep (keys==kBuiltRouteIds, above).
      expect(kBuiltRouteIds, contains('pm-checklist'));
      expect(mobileScreenBuilders.containsKey('pm-checklist'), isTrue);
      expect(kMobileRouteIds, contains('pm-checklist'));
    },
  );

  test('pm-notes is a built route in lockstep (feature/mobile-pm-notes)', () {
    // The PM flow's third write screen (the maintenance log): a built tab route
    // (honest-empty with no selection) that pm-checklist also pushes with a real
    // work-order id. Its builder + built id must stay in lockstep
    // (keys==kBuiltRouteIds, asserted above).
    expect(kBuiltRouteIds, contains('pm-notes'));
    expect(mobileScreenBuilders.containsKey('pm-notes'), isTrue);
    expect(kMobileRouteIds, contains('pm-notes'));
  });

  test('pm-close is a built route in lockstep (feature/mobile-pm-close)', () {
    // The PM flow's last step (the READ-ONLY close summary): a built tab route
    // (honest-empty with no selection) that pm-notes also pushes with a real
    // work-order id. Its builder + built id must stay in lockstep
    // (keys==kBuiltRouteIds, asserted above).
    expect(kBuiltRouteIds, contains('pm-close'));
    expect(mobileScreenBuilders.containsKey('pm-close'), isTrue);
    expect(kMobileRouteIds, contains('pm-close'));
  });

  test('field-gr is a built route in lockstep (feature/mobile-field-gr)', () {
    // The site's REVIEW of a recorded goods receipt — a distinct screen from
    // st-receive, which ENTERS counts against a PO (field_gr_agg.dart; B-324).
    // A built tab route that follows the register's newest RECEIVED receipt when
    // mounted without a selection. Builder + built id must stay in lockstep
    // (keys==kBuiltRouteIds, asserted above).
    expect(kBuiltRouteIds, contains('field-gr'));
    expect(mobileScreenBuilders.containsKey('field-gr'), isTrue);
    expect(kMobileRouteIds, contains('field-gr'));
  });

  test('field-gr and st-receive are two DIFFERENT builders', () {
    // Routing both ids at one screen is the near-duplicate this port exists to
    // avoid: it would be two places to fix every future defect, and neither
    // screen can render the other's content (st-receive has no name/unit source,
    // field-gr has no count input).
    expect(
      identical(
        mobileScreenBuilders['field-gr'],
        mobileScreenBuilders['st-receive'],
      ),
      isFalse,
    );
  });

  test('the whole pm-* flow is now built end to end', () {
    // pm-jobs -> pm-checkin -> pm-checklist -> pm-notes -> pm-close. A regression
    // that dropped any one of them from the router would strand the chain at that
    // step (the pushing screen would navigate to a placeholder).
    for (final String id in <String>[
      'pm-jobs',
      'pm-checkin',
      'pm-checklist',
      'pm-notes',
      'pm-close',
    ]) {
      expect(kBuiltRouteIds, contains(id), reason: '$id must be built');
      expect(mobileScreenBuilders.containsKey(id), isTrue, reason: id);
    }
  });

  test(
    'st-receive is a built route in lockstep (feature/mobile-st-receive-f2)',
    () {
      // The store's count-and-receive (GR) screen: a built tab route (honest-empty
      // with no selection) that st-grlist also pushes with a REAL po id. Its
      // builder + built id must stay in lockstep (keys==kBuiltRouteIds, above).
      expect(kBuiltRouteIds, contains('st-receive'));
      expect(mobileScreenBuilders.containsKey('st-receive'), isTrue);
      expect(kMobileRouteIds, contains('st-receive'));
    },
  );

  test('the store receive chain st-grlist -> st-receive is built end to end', () {
    // st-grlist's receive affordance was an honest no-op until st-receive existed.
    // Dropping either from the router would strand the storekeeper on a placeholder
    // at the point of counting goods.
    for (final String id in <String>['st-grlist', 'st-receive']) {
      expect(kBuiltRouteIds, contains(id), reason: '$id must be built');
      expect(mobileScreenBuilders.containsKey(id), isTrue, reason: id);
    }
  });

  test('route parity: 22 of the 26 known routes are built', () {
    // The count is asserted explicitly so a port that registers a BUILDER without
    // its built id (or the reverse) is caught as a number, not only as a set
    // mismatch. 19 -> 20 with st-receive; 20 -> 21 with field-gr; 21 -> 22 with
    // field-stock.
    expect(kBuiltRouteIds.length, 22);
    expect(mobileScreenBuilders.length, 22);
    expect(mobileScreenBuilders.keys.toSet(), kBuiltRouteIds);
  });
}
