// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';
import '../models/get_land_plots_response.dart';
import '../models/get_sales_bookings_response.dart';
import '../models/get_sales_contracts_response.dart';
import '../models/get_sales_downs_response.dart';
import '../models/get_sales_leads_response.dart';
import '../models/get_sales_loans_response.dart';
import '../models/land_plots_id_dd_request_body.dart';
import '../models/land_plots_id_deal_request_body.dart';

part 'land_sales_api.g.dart';

@RestApi()
abstract class LandSalesApi {
  factory LandSalesApi(Dio dio, {String? baseUrl}) = _LandSalesApi;

  /// List land plots.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/land/plots')
  Future<GetLandPlotsResponse> listLandPlots({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create land plot
  @POST('/land/plots')
  Future<Entity> createLandPlot({
    @Body() required Entity body,
  });

  /// Advance land plot stage (action endpoint)
  @POST('/land/plots/{id}/advance-stage')
  Future<Entity> advanceLandPlotStage({
    @Path('id') required String id,
  });

  /// Update land plot due-diligence ({checklist})
  @PUT('/land/plots/{id}/dd')
  Future<Entity> updateLandPlotDd({
    @Path('id') required String id,
    @Body() required LandPlotsIdDdRequestBody body,
  });

  /// Create land plot deal ({type:buy|lease, terms{}}) (action endpoint)
  @POST('/land/plots/{id}/deal')
  Future<Entity> createLandPlotDeal({
    @Path('id') required String id,
    @Body() required LandPlotsIdDealRequestBody body,
  });

  /// List sales leads.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/sales/leads')
  Future<GetSalesLeadsResponse> listSalesLeads({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create sales lead
  @POST('/sales/leads')
  Future<Entity> createSalesLead({
    @Body() required Entity body,
  });

  /// List sales bookings.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/sales/bookings')
  Future<GetSalesBookingsResponse> listSalesBookings({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create sales booking
  @POST('/sales/bookings')
  Future<Entity> createSalesBooking({
    @Body() required Entity body,
  });

  /// List sales contracts.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/sales/contracts')
  Future<GetSalesContractsResponse> listSalesContracts({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create sales contract
  @POST('/sales/contracts')
  Future<Entity> createSalesContract({
    @Body() required Entity body,
  });

  /// List sales down payments.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/sales/downs')
  Future<GetSalesDownsResponse> listSalesDowns({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create sales down payment
  @POST('/sales/downs')
  Future<Entity> createSalesDown({
    @Body() required Entity body,
  });

  /// List sales loans.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/sales/loans')
  Future<GetSalesLoansResponse> listSalesLoans({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create sales loan
  @POST('/sales/loans')
  Future<Entity> createSalesLoan({
    @Body() required Entity body,
  });

  /// Transfer sales unit (action endpoint)
  @POST('/sales/units/{id}/transfer')
  Future<Entity> transferSalesUnit({
    @Path('id') required String id,
    @Body() Entity? body,
  });
}
