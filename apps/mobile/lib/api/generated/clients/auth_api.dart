// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/auth_login_input.dart';
import '../models/auth_login_result.dart';
import '../models/entity.dart';
import '../models/get_roles_response.dart';
import '../models/get_users_response.dart';
import '../models/me.dart';

part 'auth_api.g.dart';

@RestApi()
abstract class AuthApi {
  factory AuthApi(Dio dio, {String? baseUrl}) = _AuthApi;

  /// Login (POST /auth/login {email,password})
  @POST('/auth/login')
  Future<AuthLoginResult> authLogin({
    @Body() required AuthLoginInput body,
  });

  /// Request password reset (POST /auth/forgot)
  @POST('/auth/forgot')
  Future<Entity> authForgot({
    @Body() required Entity body,
  });

  /// Reset password (POST /auth/reset)
  @POST('/auth/reset')
  Future<Entity> authReset({
    @Body() required Entity body,
  });

  /// Current user (GET /me → user + role + approval_limits + package)
  @GET('/me')
  Future<Me> getMe();

  /// List tenant users (GET /users?filter&page).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/users')
  Future<GetUsersResponse> listUsers({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Invite tenant user (email invite; username generated from email; status starts invited)
  @POST('/users')
  Future<Entity> createUser({
    @Body() required Entity body,
  });

  /// List tenant roles with permission matrix (GET /roles?filter&page).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/roles')
  Future<GetRolesResponse> listRoles({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create tenant role (name + approval limit + approval level + permission matrix)
  @POST('/roles')
  Future<Entity> createRole({
    @Body() required Entity body,
  });

  /// Update tenant role (permission matrix save)
  @PUT('/roles/{id}')
  Future<Entity> updateRole({
    @Path('id') required String id,
    @Body() required Entity body,
  });
}
