// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';
import '../models/pm_contracts_request_body.dart';
import '../models/pm_quotes_id_decide_request_body.dart';
import '../models/pm_quotes_request_body.dart';
import '../models/pm_workorders_id_checkin_request_body.dart';
import '../models/pm_workorders_id_checklist_request_body.dart';
import '../models/pm_workorders_id_close_request_body.dart';

part 'pm_api.g.dart';

@RestApi()
abstract class PmApi {
  factory PmApi(Dio dio, {String? baseUrl}) = _PmApi;

  /// List PM contracts.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/pm/contracts')
  Future<List<Entity>> listPmContracts({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create PM contract ({project_id,mode:ma|visits,visits_per_year,sla}) — mode=visits gen schedule+WO
  @POST('/pm/contracts')
  Future<Entity> createPmContract({
    @Body() required PmContractsRequestBody body,
  });

  /// List PM assets.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/pm/assets')
  Future<List<Entity>> listPmAssets({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create PM asset
  @POST('/pm/assets')
  Future<Entity> createPmAsset({
    @Body() required Entity body,
  });

  /// List checklist templates.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/pm/checklist-templates')
  Future<List<Entity>> listPmChecklistTemplates({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create checklist template
  @POST('/pm/checklist-templates')
  Future<Entity> createPmChecklistTemplate({
    @Body() required Entity body,
  });

  /// List PM work orders.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/pm/workorders')
  Future<List<Entity>> listPmWorkorders({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create PM work order
  @POST('/pm/workorders')
  Future<Entity> createPmWorkorder({
    @Body() required Entity body,
  });

  /// Work order check-in ({gps}) (action endpoint)
  @POST('/pm/workorders/{id}/checkin')
  Future<Entity> checkinPmWorkorder({
    @Path('id') required String id,
    @Body() required PmWorkordersIdCheckinRequestBody body,
  });

  /// Update work order checklist ({items[{result,before,after}]})
  @PUT('/pm/workorders/{id}/checklist')
  Future<Entity> updatePmWorkorderChecklist({
    @Path('id') required String id,
    @Body() required PmWorkordersIdChecklistRequestBody body,
  });

  /// Close work order ({cause,fix,advice,signature}) → gen certificate + push LINE (action endpoint)
  @POST('/pm/workorders/{id}/close')
  Future<Entity> closePmWorkorder({
    @Path('id') required String id,
    @Body() required PmWorkordersIdCloseRequestBody body,
  });

  /// Create PM quote ({wo_id,parts[]})
  @POST('/pm/quotes')
  Future<Entity> createPmQuote({
    @Body() required PmQuotesRequestBody body,
  });

  /// Decide PM quote ({approve}) — customer via LINE (action endpoint)
  @POST('/pm/quotes/{id}/decide')
  Future<Entity> decidePmQuote({
    @Path('id') required String id,
    @Body() required PmQuotesIdDecideRequestBody body,
  });
}
