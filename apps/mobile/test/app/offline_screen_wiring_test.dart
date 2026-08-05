// Every offline-write screen takes the APP's drain processor (B-262).
//
// This is the site inventory as a test. Before this slice each of these three hosts
// built its OWN `QueueDrainProcessor` inside `build()` — inside a FutureBuilder
// builder, so a fresh one on every rebuild, each with its own re-entrancy guard.
// Fixing only the one screen that was pointed at would have left the same defect in
// the other two, so all three are asserted here and a revert of ANY of them is red.
//
// `grep -rn 'QueueDrainProcessor(' lib/` must show exactly one construction site in
// app_services.dart (plus the class's own declaration). These tests pin the same
// thing from the other direction: each host's repository must hold the IDENTICAL
// instance AppServices owns.
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/app_scope.dart';
import 'package:juneflow_mobile/app/app_services.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_repository.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_screen.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_repository.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_screen.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_repository.dart';
import 'package:juneflow_mobile/screens/pm_notes/pm_notes_screen.dart';

/// 404s every read so the hosts mount deterministically and offline.
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<AppServices> boot(WidgetTester tester) async {
    final AppServices services = (await tester.runAsync(
      () => AppServices.bootstrap(openQueue: () async => null),
    ))!;
    services.dio.httpClientAdapter = _Fake404Adapter();
    return services;
  }

  Future<void> pumpHost(
    WidgetTester tester,
    AppServices services,
    Widget host,
  ) async {
    await tester.pumpWidget(
      AppScope(
        services: services,
        child: MaterialApp(home: host),
      ),
    );
    // The hosts resolve their i18n sidecar from a real asset future.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
  }

  testWidgets('pm-checkin host uses AppServices.syncProcessor', (
    WidgetTester tester,
  ) async {
    final AppServices services = await boot(tester);
    await pumpHost(
      tester,
      services,
      const PmCheckinScreenHost(workOrderId: 'wo-1'),
    );

    final PmCheckinScreen screen = tester.widget<PmCheckinScreen>(
      find.byType(PmCheckinScreen),
    );
    final QueueBackedPmCheckinRepository repo =
        screen.repo as QueueBackedPmCheckinRepository;
    expect(identical(repo.processor, services.syncProcessor), isTrue);
    // ...which is the processor over THE app queue, so a write this screen queues
    // is visible to the resume trigger and to the other two screens.
    expect(identical(repo.processor.queue, services.syncQueue), isTrue);
  });

  testWidgets('pm-notes host uses AppServices.syncProcessor', (
    WidgetTester tester,
  ) async {
    final AppServices services = await boot(tester);
    await pumpHost(
      tester,
      services,
      const PmNotesScreenHost(workOrderId: 'wo-1'),
    );

    final PmNotesScreen screen = tester.widget<PmNotesScreen>(
      find.byType(PmNotesScreen),
    );
    final DioPmNotesRepository repo = screen.repo as DioPmNotesRepository;
    expect(identical(repo.processor, services.syncProcessor), isTrue);
  });

  testWidgets('pm-checklist host uses AppServices.syncProcessor', (
    WidgetTester tester,
  ) async {
    final AppServices services = await boot(tester);
    await pumpHost(
      tester,
      services,
      const PmChecklistScreenHost(workOrderId: 'wo-1'),
    );

    final PmChecklistScreen screen = tester.widget<PmChecklistScreen>(
      find.byType(PmChecklistScreen),
    );
    final DioPmChecklistRepository repo =
        screen.repo as DioPmChecklistRepository;
    expect(identical(repo.processor, services.syncProcessor), isTrue);
  });
}
