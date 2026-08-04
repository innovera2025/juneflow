// Compile-time environment for the app shell (MOB-SHELL-00).
//
// Values are read from `--dart-define` so NOTHING secret is baked into source
// (root CLAUDE.md: no secrets in the repo). A build supplies them like:
//
//   flutter run \
//     --dart-define=JUNEFLOW_API_BASE_URL=http://10.0.2.2:3000/api/v1 \
//     --dart-define=JUNEFLOW_DEV_BEARER=<a dev JWT>
//
// The bearer is a DEV convenience only: the canonical mobile auth entry (a login
// screen vs. reusing the web token) is an open question filed in BLOCKERS.md, so
// the shell proceeds on a dart-defined token until Wei rules it.
abstract final class AppEnv {
  AppEnv._();

  /// Base URL of the Juneflow API. Defaults to the local dev server: apps/api
  /// listens on PORT 3000 and the contract prefix is /api/v1
  /// (packages/contracts/openapi.yaml servers[].url). Override per environment
  /// with --dart-define=JUNEFLOW_API_BASE_URL=...
  static const String apiBaseUrl = String.fromEnvironment(
    'JUNEFLOW_API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  /// Dev bearer token injected into the Authorization header — no hardcoded
  /// secret, empty unless a build defines it. Empty => requests go out
  /// unauthenticated and the API answers 401, which is the honest state until
  /// the real auth entry lands.
  static const String devBearer = String.fromEnvironment('JUNEFLOW_DEV_BEARER');

  /// Whether a dev bearer was supplied at build time.
  static bool get hasDevBearer => devBearer.isNotEmpty;
}
