// Smoke + navigation tests for the app shell (MOB-SHELL-00).
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard,
// and these assert the tab labels render byte-exact for the default (th) locale.
//
// These use bounded pump() rather than pumpAndSettle(): the shell has no
// AnimationController, but MaterialApp keeps a frame scheduled (locale/overlay
// bookkeeping), so pumpAndSettle would never return. A couple of explicit pumps
// build the tree and apply setState.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/app_services.dart';
import 'package:juneflow_mobile/main.dart';
import 'package:juneflow_mobile/screens/approvals_inbox/approvals_inbox_screen.dart';
import 'package:juneflow_mobile/screens/pm_jobs/pm_jobs_screen.dart';
import 'package:juneflow_mobile/shell/mobile_shell.dart';
import 'package:juneflow_mobile/shell/screen_placeholder.dart';
import 'package:juneflow_mobile/widgets/m_tab_bar.dart';

Future<void> _pumpShell(WidgetTester tester) async {
  // bootstrap() does real asset I/O (rootBundle) — run it in the REAL async zone
  // via runAsync, or it deadlocks against the widget test's fake clock.
  final AppServices services = (await tester.runAsync(
    () => AppServices.bootstrap(),
  ))!;
  await tester.pumpWidget(JuneflowApp(services: services));
  await tester.pump(); // build the tree
  // Bounded pump (never pumpAndSettle) — resolves the async localization future
  // and any one-shot animation without waiting for a perpetual settle.
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  testWidgets('boots to the inbox screen with the canonical 5-tab bar', (
    WidgetTester tester,
  ) async {
    await _pumpShell(tester);

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(MobileShell), findsOneWidget);
    expect(find.byType(MTabBar), findsOneWidget);

    // Initial route = inbox → the real ported approvals-inbox host mounts
    // (feature/mobile-inbox-detail), no longer an honest placeholder.
    expect(find.byType(ApprovalsInboxScreenHost), findsOneWidget);
    expect(find.widgetWithText(ScreenPlaceholder, 'inbox'), findsNothing);

    // The 5 tab labels render byte-exact for th (pototype/mobile-screens.jsx:3-26).
    for (final String label in <String>[
      'อนุมัติ',
      'หน้างาน',
      'แจ้งซ่อม',
      'Dashboard',
      'โปรไฟล์',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'tab "$label" missing');
    }

    // Honest-empty badge: the prototype's hardcoded 17 is never shown.
    expect(find.text('17'), findsNothing);
  });

  testWidgets('enabled tab navigates; disabled me tab is a no-op (B-241)', (
    WidgetTester tester,
  ) async {
    await _pumpShell(tester);

    // Tapping โปรไฟล์ (honest-disabled) does nothing — still on the inbox host.
    await tester.tap(find.text('โปรไฟล์'), warnIfMissed: false);
    await tester.pump();
    expect(find.byType(ApprovalsInboxScreenHost), findsOneWidget);

    // Tapping หน้างาน (field) lands on its section entry route, pm-jobs — a real
    // ported screen (feature/mobile-pm-jobs), so its host mounts (the shell swaps
    // the route, so the inbox host is gone).
    await tester.tap(find.text('หน้างาน'));
    await tester.pump();
    expect(find.byType(PmJobsScreenHost), findsOneWidget);
    expect(find.widgetWithText(ScreenPlaceholder, 'pm-jobs'), findsNothing);
    expect(find.byType(ApprovalsInboxScreenHost), findsNothing);
  });
}
