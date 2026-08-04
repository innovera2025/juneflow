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
    'no screen is registered yet — every route resolves to a placeholder',
    () {
      expect(kBuiltRouteIds, isEmpty);
      expect(mobileScreenBuilders, isEmpty);
    },
  );

  testWidgets('the router renders an honest placeholder for an unbuilt route', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) =>
              resolveMobileScreen(context, 'pm-jobs'),
        ),
      ),
    );
    expect(find.byType(ScreenPlaceholder), findsOneWidget);
    expect(find.text('pm-jobs'), findsOneWidget);
  });
}
