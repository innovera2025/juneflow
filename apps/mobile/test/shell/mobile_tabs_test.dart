// Tests for the 5-tab MTabBar model + honest-disable (MOB-SHELL-00).
//
// These pin the B-241 ruling in code: the canonical 5 tabs, and โปรไฟล์ (`me`)
// disabled because it has no destination screen.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/shell/mobile_routes.dart';
import 'package:juneflow_mobile/shell/mobile_sections.dart';
import 'package:juneflow_mobile/shell/mobile_tabs.dart';

void main() {
  test('there are exactly 5 tabs, in prototype order', () {
    expect(kMobileTabs.map((MobileTab t) => t.id).toList(), <String>[
      'approve',
      'field',
      'service',
      'exec',
      'me',
    ]);
  });

  test('the me (โปรไฟล์) tab is honest-disabled — no destination (B-241)', () {
    final MobileTab me = kMobileTabs.firstWhere((MobileTab t) => t.id == 'me');
    expect(me.enabled, isFalse);
    expect(me.destination, isNull);
    expect(me.section, isNull);
  });

  test('the other four tabs are enabled and land on a known route', () {
    final Iterable<MobileTab> others = kMobileTabs.where(
      (MobileTab t) => t.id != 'me',
    );
    expect(others.length, 4);
    for (final MobileTab t in others) {
      expect(t.enabled, isTrue, reason: '${t.id} should be enabled');
      expect(t.section, isNotNull, reason: '${t.id} should have a section');
      expect(
        kMobileRouteIds.contains(t.destination),
        isTrue,
        reason: '${t.id} destination ${t.destination} must be a known route',
      );
    }
  });

  test('each enabled tab lands on a route within its own section', () {
    for (final MobileTab t in kMobileTabs.where((MobileTab t) => t.enabled)) {
      expect(sectionForRoute(t.destination!), t.section);
    }
  });

  test('every tab references a non-empty sidecar label field', () {
    for (final MobileTab t in kMobileTabs) {
      expect(t.labelField, isNotEmpty);
    }
  });

  test('the four sections each have at least one destination tab', () {
    final Set<MobileSection?> tabSections = kMobileTabs
        .map((MobileTab t) => t.section)
        .toSet();
    for (final MobileSection s in MobileSection.values) {
      expect(tabSections.contains(s), isTrue, reason: 'no tab for $s');
    }
  });
}
