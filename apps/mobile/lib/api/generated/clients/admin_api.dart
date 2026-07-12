// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';

part 'admin_api.g.dart';

@RestApi()
abstract class AdminApi {
  factory AdminApi(Dio dio, {String? baseUrl}) = _AdminApi;

  /// List packages (S/M/L/Full).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/admin/packages')
  Future<List<Entity>> listAdminPackages({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create package ({price,limits,menus[],sub_rules})
  @POST('/admin/packages')
  Future<Entity> createAdminPackage({
    @Body() required Entity body,
  });

  /// Get package by id
  @GET('/admin/packages/{id}')
  Future<Entity> getAdminPackage({
    @Path('id') required String id,
  });

  /// Update package (never changes status — use action endpoints)
  @PUT('/admin/packages/{id}')
  Future<Entity> updateAdminPackage({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// List subscribers (companies + usage).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/admin/subscribers')
  Future<List<Entity>> listAdminSubscribers({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Change subscriber package (PUT {package_id,seats})
  @PUT('/admin/subscribers/{id}/package')
  Future<Entity> setAdminSubscriberPackage({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// Suspend subscriber (action endpoint)
  @POST('/admin/subscribers/{id}/suspend')
  Future<Entity> suspendAdminSubscriber({
    @Path('id') required String id,
  });

  /// Notify subscriber (action endpoint)
  @POST('/admin/subscribers/{id}/notify')
  Future<Entity> notifyAdminSubscriber({
    @Path('id') required String id,
    @Body() Entity? body,
  });

  /// List users (GET /admin/users?company=).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/admin/users')
  Future<List<Entity>> listAdminUsers({
    @Query('company') String? company,
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Block user (action endpoint)
  @POST('/admin/users/{id}/block')
  Future<Entity> blockAdminUser({
    @Path('id') required String id,
  });

  /// Reset user password (action endpoint)
  @POST('/admin/users/{id}/reset-password')
  Future<Entity> resetAdminUserPassword({
    @Path('id') required String id,
  });

  /// List platform invoices.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/admin/invoices')
  Future<List<Entity>> listAdminInvoices({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Send invoice reminder (action endpoint)
  @POST('/admin/invoices/{id}/remind')
  Future<Entity> remindAdminInvoice({
    @Path('id') required String id,
  });
}
