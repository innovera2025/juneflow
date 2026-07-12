// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';
import '../models/job.dart';
import '../models/reports_id_export_request_body.dart';

part 'dms_api.g.dart';

@RestApi()
abstract class DmsApi {
  factory DmsApi(Dio dio, {String? baseUrl}) = _DmsApi;

  /// List documents (GET ?cat=&project=).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/documents')
  Future<List<Entity>> listDocuments({
    @Query('cat') String? cat,
    @Query('project') String? project,
    @Query('page') int? page,
  });

  /// Create document (DMS)
  @POST('/documents')
  Future<Entity> createDocument({
    @Body() required Entity body,
  });

  /// List document versions
  @GET('/documents/{id}/versions')
  Future<List<Entity>> listDocumentVersions({
    @Path('id') required String id,
  });

  /// List notifications.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/notifications')
  Future<List<Entity>> listNotifications({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Mark notification read (action endpoint)
  @POST('/notifications/{id}/read')
  Future<Entity> readNotification({
    @Path('id') required String id,
  });

  /// Query audit log (GET ?entity=&user=&action=).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/audit-log')
  Future<List<Entity>> listAuditLog({
    @Query('entity') String? entity,
    @Query('user') String? user,
    @Query('action') String? action,
    @Query('page') int? page,
  });

  /// Reports hub (all-module report list)
  @GET('/reports/hub')
  Future<List<Entity>> getReportsHub();

  /// Export a report ({format}) — async job
  @POST('/reports/{id}/export')
  Future<Job> exportReport({
    @Path('id') required String id,
    @Body() required ReportsIdExportRequestBody body,
  });
}
