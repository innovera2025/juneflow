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
//
// pm-close JOINED this inventory under B-331. It was read-only when this file was
// written — its close was withheld because no signature could be captured (B-288) —
// so it had no processor to get wrong. Now that it queues a real write, leaving it
// out would be exactly the omission the paragraph above warns about.
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/app_scope.dart';
import 'package:juneflow_mobile/app/app_services.dart';
import 'package:juneflow_mobile/offline/pending_op_adoption.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_repository.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_screen.dart';
import 'package:juneflow_mobile/screens/pm_checklist/pm_checklist_repository.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_repository.dart';
import 'package:juneflow_mobile/screens/pm_close/pm_close_screen.dart';
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

  testWidgets('pm-close host uses AppServices.syncProcessor (B-331)', (
    WidgetTester tester,
  ) async {
    final AppServices services = await boot(tester);
    await pumpHost(
      tester,
      services,
      const PmCloseScreenHost(workOrderId: 'wo-1'),
    );

    final PmCloseScreen screen = tester.widget<PmCloseScreen>(
      find.byType(PmCloseScreen),
    );
    final DioPmCloseRepository repo = screen.repo as DioPmCloseRepository;
    expect(identical(repo.processor, services.syncProcessor), isTrue);
    expect(identical(repo.processor.queue, services.syncQueue), isTrue);
  });

  test('the pm-close op identity names the REAL endpoint', () {
    // The one place the queued write's endpoint and entity type are defined. The
    // screen tests drive a fake repository, so nothing else would notice this drift
    // — and a wrong endpoint here fails only at REPLAY time, offline, on a
    // technician's phone, long after the screen reported the write as captured.
    final SyncOpIdentity id = pmCloseOpIdentity('wo-1');
    expect(id.entityType, 'pm_close');
    expect(id.endpoint, '/pm/workorders/wo-1/close');
  });
}
