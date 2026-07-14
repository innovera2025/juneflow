// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/counts.dart';
import '../models/entity.dart';
import '../models/get_audit_log_response.dart';
import '../models/get_documents_id_versions_response.dart';
import '../models/get_documents_response.dart';
import '../models/get_notifications_response.dart';
import '../models/get_reports_hub_response.dart';
import '../models/job.dart';
import '../models/keys.dart';
import '../models/reports_id_export_request_body.dart';

part 'dms_api.g.dart';

@RestApi()
abstract class DmsApi {
  factory DmsApi(Dio dio, {String? baseUrl}) = _DmsApi;

  /// Nav badge counts (GET /counts?keys=... → {key: count}).
  ///
  /// Tenant-scoped pending-work counts for the sidebar badges — B-040(ก). The 9 keys are the NAV badge sources in pototype chrome.jsx; decision C10 forbids hardcoded badge numbers, so each count is a live query over the module's pending-state rows (flows.html state machines). Counts never escape the JWT's company_id tenant scope.
  ///
  /// [keys] - Comma-separated nav badge ids to count. An unknown key answers 400 with the flat Error shape.
  @GET('/counts')
  Future<Counts> getCounts({
    @Query('keys') required List<Keys> keys,
  });

  /// List documents (GET ?cat=&project=).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/documents')
  Future<GetDocumentsResponse> listDocuments({
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
  Future<GetDocumentsIdVersionsResponse> listDocumentVersions({
    @Path('id') required String id,
  });

  /// List notifications.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/notifications')
  Future<GetNotificationsResponse> listNotifications({
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
  Future<GetAuditLogResponse> listAuditLog({
    @Query('entity') String? entity,
    @Query('user') String? user,
    @Query('action') String? action,
    @Query('page') int? page,
  });

  /// Reports hub (all-module report list)
  @GET('/reports/hub')
  Future<GetReportsHubResponse> getReportsHub();

  /// Export a report ({format}) — async job
  @POST('/reports/{id}/export')
  Future<Job> exportReport({
    @Path('id') required String id,
    @Body() required ReportsIdExportRequestBody body,
  });
}
