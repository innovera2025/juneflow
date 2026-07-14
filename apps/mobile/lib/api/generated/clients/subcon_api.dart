// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/defects_id_fix_request_body.dart';
import '../models/defects_id_recheck_request_body.dart';
import '../models/entity.dart';
import '../models/get_acceptance_center_response.dart';
import '../models/get_subcon_contracts_id_periods_response.dart';
import '../models/get_subcon_contracts_response.dart';
import '../models/periods_id_deliver_request_body.dart';
import '../models/periods_id_inspect_request_body.dart';
import '../models/type.dart';

part 'subcon_api.g.dart';

@RestApi()
abstract class SubconApi {
  factory SubconApi(Dio dio, {String? baseUrl}) = _SubconApi;

  /// List subcon contracts.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/subcon-contracts')
  Future<GetSubconContractsResponse> listSubconContracts({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create subcon contract
  @POST('/subcon-contracts')
  Future<Entity> createSubconContract({
    @Body() required Entity body,
  });

  /// List work periods of a subcon contract
  @GET('/subcon-contracts/{id}/periods')
  Future<GetSubconContractsIdPeriodsResponse> listSubconContractPeriods({
    @Path('id') required String id,
  });

  /// Deliver work period ({docs[],photos[]}) → status delivered (action endpoint)
  @POST('/periods/{id}/deliver')
  Future<Entity> deliverPeriod({
    @Path('id') required String id,
    @Body() required PeriodsIdDeliverRequestBody body,
  });

  /// Inspect work period ({result:pass|reject, defects[]}) (action endpoint)
  @POST('/periods/{id}/inspect')
  Future<Entity> inspectPeriod({
    @Path('id') required String id,
    @Body() required PeriodsIdInspectRequestBody body,
  });

  /// Approve period payment → creates AP billing (retention deducted) (action endpoint)
  @POST('/periods/{id}/approve-payment')
  Future<Entity> approvePeriodPayment({
    @Path('id') required String id,
  });

  /// Mark defect fixed ({photo_after}) (action endpoint)
  @POST('/defects/{id}/fix')
  Future<Entity> fixDefect({
    @Path('id') required String id,
    @Body() required DefectsIdFixRequestBody body,
  });

  /// Recheck defect ({result}) (action endpoint)
  @POST('/defects/{id}/recheck')
  Future<Entity> recheckDefect({
    @Path('id') required String id,
    @Body() required DefectsIdRecheckRequestBody body,
  });

  /// Acceptance center (GET ?type=gr|period|house&status=)
  @GET('/acceptance-center')
  Future<GetAcceptanceCenterResponse> listAcceptanceCenter({
    @Query('type') Type? type,
    @Query('status') String? status,
  });
}
