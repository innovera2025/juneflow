// App-wide services container for the shell (MOB-SHELL-00).
//
// One place that owns the long-lived singletons every screen leans on: the i18n
// runtime (MOB-I18N-01), the shell's own key sidecar, the Dio + generated API
// client (P0-MOB-03), and the offline sync queue + its drain processor
// (P0-MOB-05 / B-242 level-(a), made durable + app-wide by B-262). It is built once
// in main() and handed down through [AppScope].
//
// B-262 changed two things here, both about WHERE the offline machinery lives, not
// how it behaves:
//   1. the queue defaults to the DURABLE drift/SQLite store when the platform can
//      open one (openDurableSyncQueue), instead of always the in-memory queue whose
//      contents died with the process;
//   2. ONE [QueueDrainProcessor] is owned here, so draining no longer depends on a
//      particular screen being mounted (it used to be constructed inside three
//      screens' build methods).
import 'package:dio/dio.dart';

import '../api/generated/juneflow_api_client.dart';
import '../i18n/i18n.dart';
import '../offline/offline.dart';
import '../offline/sync_queue_store.dart';
import 'app_env.dart';
import 'auth_interceptor.dart';
import 'gps_source.dart';

/// Opens the durable offline queue, or null when the platform has no SQLite
/// executor available. Injectable so tests drive both outcomes.
typedef DurableSyncQueueOpener = Future<SyncQueue?> Function();

/// Immutable bag of the shell's runtime services.
class AppServices {
  AppServices({
    required this.i18n,
    required this.shellStrings,
    required this.dio,
    required this.api,
    required this.syncQueue,
    required this.syncProcessor,
    required this.tokenProvider,
    required this.gpsSource,
  }) : assert(
         identical(syncProcessor.queue, syncQueue),
         'syncProcessor must drain THE app queue — two stores means a write '
         'queued through one is invisible to the other (B-262).',
       );

  /// Key-based translator over the sacred i18n source.
  final JuneflowI18n i18n;

  /// The shell's own key sidecar (MTabBar labels) — keys only, resolved through
  /// [i18n]. Screens load their own sidecars the same way.
  final ScreenStrings shellStrings;

  /// The single Dio the whole app shares.
  final Dio dio;

  /// Generated OpenAPI client, wired onto [dio].
  final JuneflowApiClient api;

  /// Offline write queue SPINE. Exposed as the level-agnostic contract. Durable
  /// (drift/SQLite) wherever the platform can open one — see [bootstrap] and
  /// BLOCKERS.md B-289 for the one target where it still cannot.
  final SyncQueue syncQueue;

  /// The app's ONE drain processor over [syncQueue] (level-(a) policy, B-242).
  ///
  /// Owned here — not by a screen — so a queued write drains on app resume and on
  /// any screen's trigger, not only while the screen that enqueued it is mounted.
  /// [QueueDrainProcessor.drain]'s re-entrancy guard is per-instance, so a single
  /// shared instance is also what makes overlapping triggers safe.
  final QueueDrainProcessor syncProcessor;

  /// Current bearer token source (see [AuthInterceptor]).
  final TokenProvider tokenProvider;

  /// Device geolocation for offline-write screens that need a real coordinate (the
  /// PM check-in). Behind the [GpsSource] seam so tests never touch a sensor.
  final GpsSource gpsSource;

  /// Builds the container: loads i18n + the shell sidecar, wires Dio with the
  /// auth interceptor, and constructs the API client, the offline queue and the
  /// app's single drain processor.
  ///
  /// Queue selection, in order:
  ///   1. an explicitly injected [syncQueue] (tests);
  ///   2. else [openQueue] — by default the platform-conditional
  ///      `openDurableSyncQueue`, i.e. the drift/SQLite store, so a queued write
  ///      survives an app kill;
  ///   3. else [InMemorySyncQueue] — the honest degradation when the platform has
  ///      no SQLite executor (today: the web build, BLOCKERS.md B-289). Writes
  ///      still queue and replay within the session; they do not survive a reload.
  static Future<AppServices> bootstrap({
    String lang = kDefaultLang,
    SyncQueue? syncQueue,
    GpsSource? gpsSource,
    DurableSyncQueueOpener? openQueue,
  }) async {
    final JuneflowI18n i18n = await JuneflowI18n.load(lang: lang);
    final ScreenStrings shellStrings = await ScreenStrings.load('shell');

    String? tokenProvider() => AppEnv.hasDevBearer ? AppEnv.devBearer : null;

    final Dio dio = Dio(BaseOptions(baseUrl: AppEnv.apiBaseUrl))
      ..interceptors.add(AuthInterceptor(tokenProvider));
    final JuneflowApiClient api = JuneflowApiClient(dio);

    final SyncQueue queue =
        syncQueue ??
        await (openQueue ?? openDurableSyncQueue)() ??
        InMemorySyncQueue();

    return AppServices(
      i18n: i18n,
      shellStrings: shellStrings,
      dio: dio,
      api: api,
      syncQueue: queue,
      // The ONE processor. Every screen and the resume trigger share it.
      syncProcessor: QueueDrainProcessor(queue, DioSyncApiClient(dio)),
      tokenProvider: tokenProvider,
      gpsSource: gpsSource ?? const GeolocatorGpsSource(),
    );
  }
}
