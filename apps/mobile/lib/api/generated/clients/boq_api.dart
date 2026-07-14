// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/ai_qto_job_create_boq_request_body.dart';
import '../models/boq_id_generate_pr_request_body.dart';
import '../models/entity.dart';
import '../models/get_boq_id_items_response.dart';
import '../models/get_boq_response.dart';
import '../models/get_po_response.dart';
import '../models/get_pr_response.dart';
import '../models/get_wo_response.dart';
import '../models/gr_request_body.dart';
import '../models/job.dart';
import '../models/po_id_variation_order_request_body.dart';
import '../models/pr_id_reject_request_body.dart';

part 'boq_api.g.dart';

@RestApi()
abstract class BoqApi {
  factory BoqApi(Dio dio, {String? baseUrl}) = _BoqApi;

  /// List BOQ docs.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/boq')
  Future<GetBoqResponse> listBoq({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create BOQ doc
  @POST('/boq')
  Future<Entity> createBoq({
    @Body() required Entity body,
  });

  /// Submit BOQ doc (action endpoint)
  @POST('/boq/{id}/submit')
  Future<Entity> submitBoq({
    @Path('id') required String id,
  });

  /// Approve BOQ doc — locks it (action endpoint).
  ///
  /// Status changes go through action endpoints only (api-contract.md: POST /boq/:id/submit | /approve | /revise). Approve locks the BOQ doc.
  @POST('/boq/{id}/approve')
  Future<Entity> approveBoq({
    @Path('id') required String id,
  });

  /// Revise BOQ doc → new version v+1 (action endpoint)
  @POST('/boq/{id}/revise')
  Future<Entity> reviseBoq({
    @Path('id') required String id,
  });

  /// List BOQ items (GET /boq/:id/items?group=)
  @GET('/boq/{id}/items')
  Future<GetBoqIdItemsResponse> listBoqItems({
    @Path('id') required String id,
    @Query('group') String? group,
  });

  /// Bulk add BOQ items (from BOM/Excel/AI)
  @POST('/boq/{id}/items')
  Future<Entity> addBoqItems({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// Generate PR from BOQ ({item_ids[],qty{}}) — splits material/subcon PR, cuts remain
  @POST('/boq/{id}/generate-pr')
  Future<Entity> generateBoqPr({
    @Path('id') required String id,
    @Body() required BoqIdGeneratePrRequestBody body,
  });

  /// Upload model for AI QTO (deducts AI credit) → job_id
  @MultiPart()
  @POST('/ai-qto/upload')
  Future<Job> uploadAiQto({
    @Part(name: 'file') required File file,
  });

  /// AI QTO job status (progress/elements)
  @GET('/ai-qto/{job}')
  Future<Entity> getAiQtoJob({
    @Path('job') required String job,
  });

  /// Create BOQ from AI QTO result ({mappings[]})
  @POST('/ai-qto/{job}/create-boq')
  Future<Entity> createBoqFromAiQto({
    @Path('job') required String job,
    @Body() required AiQtoJobCreateBoqRequestBody body,
  });

  /// List PRs.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/pr')
  Future<GetPrResponse> listPr({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create PR
  @POST('/pr')
  Future<Entity> createPr({
    @Body() required Entity body,
  });

  /// Submit PR (action endpoint)
  @POST('/pr/{id}/submit')
  Future<Entity> submitPr({
    @Path('id') required String id,
  });

  /// Approve PR (action endpoint)
  @POST('/pr/{id}/approve')
  Future<Entity> approvePr({
    @Path('id') required String id,
  });

  /// Reject PR ({reason}) (action endpoint)
  @POST('/pr/{id}/reject')
  Future<Entity> rejectPr({
    @Path('id') required String id,
    @Body() required PrIdRejectRequestBody body,
  });

  /// List POs.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/po')
  Future<GetPoResponse> listPo({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create PO
  @POST('/po')
  Future<Entity> createPo({
    @Body() required Entity body,
  });

  /// Add PO variation order ({dir,amount,reason}) (action endpoint)
  @POST('/po/{id}/variation-order')
  Future<Entity> createPoVariationOrder({
    @Path('id') required String id,
    @Body() required PoIdVariationOrderRequestBody body,
  });

  /// List WOs.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/wo')
  Future<GetWoResponse> listWo({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create WO
  @POST('/wo')
  Future<Entity> createWo({
    @Body() required Entity body,
  });

  /// Goods receipt ({po_id,lines[{qty_ok,qty_rejected,photos[]}]}) — rejects gen defect-report
  @POST('/gr')
  Future<Entity> createGr({
    @Body() required GrRequestBody body,
  });
}
