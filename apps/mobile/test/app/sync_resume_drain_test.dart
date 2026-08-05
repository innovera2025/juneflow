// The app-lifecycle drain trigger (B-262).
//
// Before this slice there was no WidgetsBindingObserver anywhere in lib/, so the
// "on screen-mount / app-resume" trigger the level-(a) policy doc promises
// (sync_processor.dart) simply did not exist.
//
// The processor under these tests is the REAL QueueDrainProcessor over a REAL
// InMemorySyncQueue — only the HTTP client is faked, because it is the collaborator.
// So each assertion is about a queued op actually disappearing, not about a counter
// on a stub: if the trigger does not fire, the op is still in the queue and the test
// is red.
//
// The last group is the end-to-end claim: the whole real app, parked on the INBOX
// route (pm-checkin nowhere in the tree), drains a queued check-in on resume.
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/app_services.dart';
import 'package:juneflow_mobile/app/sync_resume_drain.dart';
import 'package:juneflow_mobile/main.dart';
import 'package:juneflow_mobile/offline/in_memory_sync_queue.dart';
import 'package:juneflow_mobile/offline/sync_operation.dart';
import 'package:juneflow_mobile/offline/sync_processor.dart';
import 'package:juneflow_mobile/screens/pm_checkin/pm_checkin_screen.dart';

SyncOperation _op(String id) {
  return SyncOperation(
    id: id,
    entityType: 'pm_checkin',
    kind: SyncOpKind.create,
    endpoint: '/pm/workorders/$id/checkin',
    method: 'POST',
    payload: <String, Object?>{'gps': '13.7563, 100.5018'},
    createdAt: DateTime.utc(2026, 8, 5, 9),
  );
}

/// A SyncApiClient that 200s everything and records the endpoints it saw.
class _RecordingApi implements SyncApiClient {
  final List<String> calls = <String>[];

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    calls.add(endpoint);
    return const SyncApiResponse(statusCode: 200);
  }
}

/// A SyncApiClient that always throws — a device with no connectivity.
class _OfflineApi implements SyncApiClient {
  int calls = 0;

  @override
  Future<SyncApiResponse> send({
    required String method,
    required String endpoint,
    required Map<String, Object?> payload,
  }) async {
    calls++;
    throw const SocketExceptionStandIn();
  }
}

class SocketExceptionStandIn implements Exception {
  const SocketExceptionStandIn();
}

/// Dio adapter: 200 for the check-in replay path, 404 for every read the shell's
/// screens fire, so the whole app pumps deterministically and offline.
class _CheckinOkAdapter implements HttpClientAdapter {
  final List<String> replayed = <String>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path.contains('/checkin')) {
      replayed.add(options.path);
      return ResponseBody.fromString(
        '{"data":{}}',
        200,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: <String>[Headers.jsonContentType],
        },
      );
    }
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

  group('SyncResumeDrain — the trigger', () {
    testWidgets('drains on mount (the leftover from the previous run)', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      await queue.enqueue(_op('a'));
      final _RecordingApi api = _RecordingApi();

      await tester.pumpWidget(
        SyncResumeDrain(
          processor: QueueDrainProcessor(queue, api),
          child: const SizedBox.shrink(),
        ),
      );
      await tester.pump();

      expect(api.calls, <String>['/pm/workorders/a/checkin']);
      expect(await queue.length(), 0);
    });

    testWidgets('drains again when the app returns to the foreground', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _RecordingApi api = _RecordingApi();
      await tester.pumpWidget(
        SyncResumeDrain(
          processor: QueueDrainProcessor(queue, api),
          child: const SizedBox.shrink(),
        ),
      );
      await tester.pump();
      expect(api.calls, isEmpty, reason: 'nothing queued at mount');

      // A write is queued, then the user leaves and comes back.
      await queue.enqueue(_op('b'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(
        api.calls,
        isEmpty,
        reason: 'backgrounding must not fire a replay',
      );

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(api.calls, <String>['/pm/workorders/b/checkin']);
      expect(await queue.length(), 0);
    });

    testWidgets('inactive / hidden / detached do not drain', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _RecordingApi api = _RecordingApi();
      await tester.pumpWidget(
        SyncResumeDrain(
          processor: QueueDrainProcessor(queue, api),
          child: const SizedBox.shrink(),
        ),
      );
      await tester.pump();
      await queue.enqueue(_op('c'));

      for (final AppLifecycleState s in <AppLifecycleState>[
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.detached,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(s);
        await tester.pump();
      }
      expect(api.calls, isEmpty);
      expect(await queue.length(), 1, reason: 'still queued, still safe');
    });

    testWidgets('stops draining once it is disposed', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      final _RecordingApi api = _RecordingApi();
      await tester.pumpWidget(
        SyncResumeDrain(
          processor: QueueDrainProcessor(queue, api),
          child: const SizedBox.shrink(),
        ),
      );
      await tester.pump();

      await tester.pumpWidget(const SizedBox.shrink()); // dispose
      await queue.enqueue(_op('d'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(api.calls, isEmpty, reason: 'the observer must be removed');
    });

    testWidgets('a failing replay does not escape as an unhandled error', (
      WidgetTester tester,
    ) async {
      final InMemorySyncQueue queue = InMemorySyncQueue();
      await queue.enqueue(_op('e'));
      final _OfflineApi api = _OfflineApi();

      await tester.pumpWidget(
        SyncResumeDrain(
          processor: QueueDrainProcessor(queue, api),
          child: const SizedBox.shrink(),
        ),
      );
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(api.calls, 1);
      // The (a) policy is untouched: a transport failure keeps the op queued.
      final SyncOperation still = (await queue.pending()).single;
      expect(still.status, SyncOpStatus.pending);
      expect(still.attemptCount, 1);
    });

    testWidgets('renders its child untouched', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: SyncResumeDrain(
            processor: QueueDrainProcessor(
              InMemorySyncQueue(),
              _RecordingApi(),
            ),
            child: const Text('child'),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('child'), findsOneWidget);
    });
  });

  group('the real app drains without pm-checkin mounted', () {
    testWidgets('a queued check-in replays on resume from the inbox route', (
      WidgetTester tester,
    ) async {
      final _CheckinOkAdapter adapter = _CheckinOkAdapter();
      final InMemorySyncQueue queue = InMemorySyncQueue();

      // Real bootstrap (real i18n assets), then the real Dio swapped for the
      // deterministic adapter so no socket is opened.
      final AppServices services = (await tester.runAsync(
        () => AppServices.bootstrap(
          syncQueue: queue,
          openQueue: () async => null,
        ),
      ))!;
      services.dio.httpClientAdapter = adapter;

      await tester.pumpWidget(JuneflowApp(services: services));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      // The app boots on `inbox`. pm-checkin — the screen that used to own the
      // only processor — is nowhere in the tree.
      expect(find.byType(PmCheckinScreenHost), findsNothing);

      // A check-in queued in a previous run (or by a screen since disposed).
      await queue.enqueue(_op('wo-77'));

      await tester.runAsync(() async {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        // Let the real Dio replay complete outside the fake clock.
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();

      expect(
        adapter.replayed,
        <String>['/pm/workorders/wo-77/checkin'],
        reason: 'the shared processor replayed it with no pm-checkin mounted',
      );
      expect(await queue.length(), 0);
    });
  });
}
