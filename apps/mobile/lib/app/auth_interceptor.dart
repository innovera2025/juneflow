// Dio auth interceptor for the app shell (MOB-SHELL-00).
//
// Every Juneflow API request must carry `Authorization: Bearer <jwt>` — the JWT
// carries company_id (tenant scope) (packages/contracts/openapi.yaml security).
// This interceptor stamps that header on outgoing requests from a token provided
// at call time, so token rotation (or a future login flow replacing the
// dart-defined dev bearer) needs no change here.
import 'package:dio/dio.dart';

/// Supplies the current bearer token, or null when there is none yet.
///
/// A function (not a stored string) so the source of truth can change — a dev
/// bearer today, a secure-storage session token once the auth entry lands —
/// without touching the interceptor.
typedef TokenProvider = String? Function();

/// Adds `Authorization: Bearer <token>` to each request when a token exists.
class AuthInterceptor extends Interceptor {
  AuthInterceptor(this._tokenProvider);

  final TokenProvider _tokenProvider;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final String? token = _tokenProvider();
    // No token => send unauthenticated rather than an empty "Bearer " header;
    // the API answering 401 is the honest signal that auth is not wired yet.
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }
}
