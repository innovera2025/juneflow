// Tests for the Dio auth interceptor (MOB-SHELL-00).
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/app/auth_interceptor.dart';

void main() {
  RequestOptions runWithToken(String? token) {
    final RequestOptions options = RequestOptions(path: '/me');
    AuthInterceptor(
      () => token,
    ).onRequest(options, RequestInterceptorHandler());
    return options;
  }

  test('stamps Bearer <token> when a token is present', () {
    expect(runWithToken('dev-jwt').headers['Authorization'], 'Bearer dev-jwt');
  });

  test('sends no Authorization header when the token is null', () {
    expect(runWithToken(null).headers.containsKey('Authorization'), isFalse);
  });

  test('sends no Authorization header when the token is empty', () {
    expect(runWithToken('').headers.containsKey('Authorization'), isFalse);
  });
}
