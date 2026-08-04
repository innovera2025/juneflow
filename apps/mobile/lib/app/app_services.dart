// App-wide services container for the shell (MOB-SHELL-00).
//
// One place that owns the long-lived singletons every screen leans on: the i18n
// runtime (MOB-I18N-01), the shell's own key sidecar, the Dio + generated API
// client (P0-MOB-03), and the offline sync queue SPINE (P0-MOB-05). It is built
// once in main() and handed down through [AppScope]; nothing here decides offline
// DEPTH — that (level (a)/(b), Open Q #5 / BLOCKERS.md B-242) is deferred, so the
// queue is exposed as the level-agnostic [SyncQueue] contract only.
import 'package:dio/dio.dart';

import '../api/generated/juneflow_api_client.dart';
import '../i18n/i18n.dart';
import '../offline/offline.dart';
import 'app_env.dart';
import 'auth_interceptor.dart';

/// Immutable bag of the shell's runtime services.
class AppServices {
  AppServices({
    required this.i18n,
    required this.shellStrings,
    required this.dio,
    required this.api,
    required this.syncQueue,
    required this.tokenProvider,
  });

  /// Key-based translator over the sacred i18n source.
  final JuneflowI18n i18n;

  /// The shell's own key sidecar (MTabBar labels) — keys only, resolved through
  /// [i18n]. Screens load their own sidecars the same way.
  final ScreenStrings shellStrings;

  /// The single Dio the whole app shares.
  final Dio dio;

  /// Generated OpenAPI client, wired onto [dio].
  final JuneflowApiClient api;

  /// Offline write queue SPINE. Exposed as the level-agnostic contract; the
  /// drain/conflict policy is deferred (B-242). Reads do not touch it; the first
  /// offline-WRITE screen (E2) swaps the in-memory default for the drift-backed
  /// queue.
  final SyncQueue syncQueue;

  /// Current bearer token source (see [AuthInterceptor]).
  final TokenProvider tokenProvider;

  /// Builds the container: loads i18n + the shell sidecar, wires Dio with the
  /// auth interceptor, and constructs the API client and the offline queue.
  ///
  /// [syncQueue] can be injected (tests, or a drift-backed queue at a real
  /// offline-write screen); it defaults to the in-memory reference queue so the
  /// shell has a working seam without pulling in native SQLite.
  static Future<AppServices> bootstrap({
    String lang = kDefaultLang,
    SyncQueue? syncQueue,
  }) async {
    final JuneflowI18n i18n = await JuneflowI18n.load(lang: lang);
    final ScreenStrings shellStrings = await ScreenStrings.load('shell');

    String? tokenProvider() => AppEnv.hasDevBearer ? AppEnv.devBearer : null;

    final Dio dio = Dio(BaseOptions(baseUrl: AppEnv.apiBaseUrl))
      ..interceptors.add(AuthInterceptor(tokenProvider));
    final JuneflowApiClient api = JuneflowApiClient(dio);

    return AppServices(
      i18n: i18n,
      shellStrings: shellStrings,
      dio: dio,
      api: api,
      syncQueue: syncQueue ?? InMemorySyncQueue(),
      tokenProvider: tokenProvider,
    );
  }
}
