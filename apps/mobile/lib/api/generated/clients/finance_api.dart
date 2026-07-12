// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/ap_billing_request_body.dart';
import '../models/ap_pv_request_body.dart';
import '../models/ar_invoices_request_body.dart';
import '../models/ar_rv_request_body.dart';
import '../models/bank_reconcile_request_body.dart';
import '../models/entity.dart';
import '../models/etax_send_request_body.dart';
import '../models/fa_run_depreciation_request_body.dart';
import '../models/gl_close_period_request_body.dart';
import '../models/gl_post_request_body.dart';

part 'finance_api.g.dart';

@RestApi()
abstract class FinanceApi {
  factory FinanceApi(Dio dio, {String? baseUrl}) = _FinanceApi;

  /// AP billing ({po_id,gr_id,invoice_no}) — 3-way match
  @POST('/ap/billing')
  Future<Entity> createApBilling({
    @Body() required ApBillingRequestBody body,
  });

  /// AP payment voucher ({billing_ids[],wht_pct})
  @POST('/ap/pv')
  Future<Entity> createApPv({
    @Body() required ApPvRequestBody body,
  });

  /// Approve payment voucher (action endpoint)
  @POST('/pv/{id}/approve')
  Future<Entity> approvePv({
    @Path('id') required String id,
  });

  /// Export payment batch to bank file
  @POST('/bank/export-batch')
  Future<Entity> exportBankBatch({
    @Body() Entity? body,
  });

  /// AR invoice ({customer_id,lines[],credit_term}) → queues e-Tax
  @POST('/ar/invoices')
  Future<Entity> createArInvoice({
    @Body() required ArInvoicesRequestBody body,
  });

  /// AR receipt voucher ({invoice_id,amount})
  @POST('/ar/rv')
  Future<Entity> createArRv({
    @Body() required ArRvRequestBody body,
  });

  /// GL posting inbox
  @GET('/gl/posting-inbox')
  Future<List<Entity>> getGlPostingInbox();

  /// Post documents to GL ({doc_ids[]}) → gen JV
  @POST('/gl/post')
  Future<Entity> postGl({
    @Body() required GlPostRequestBody body,
  });

  /// List journal vouchers.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/gl/jv')
  Future<List<Entity>> listGlJv({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create journal voucher
  @POST('/gl/jv')
  Future<Entity> createGlJv({
    @Body() required Entity body,
  });

  /// Chart of accounts
  @GET('/gl/coa')
  Future<List<Entity>> getGlCoa();

  /// Trial balance (GET ?period=).
  ///
  /// [period] - Accounting period selector (e.g. YYYY-MM).
  @GET('/gl/reports/trial-balance')
  Future<Entity> getGlTrialBalance({
    @Query('period') String? period,
  });

  /// Financial statements (GET ?period=).
  ///
  /// [period] - Accounting period selector (e.g. YYYY-MM).
  @GET('/gl/reports/statements')
  Future<Entity> getGlStatements({
    @Query('period') String? period,
  });

  /// Project P&L (GET ?period=).
  ///
  /// [period] - Accounting period selector (e.g. YYYY-MM).
  @GET('/gl/reports/project-pl')
  Future<Entity> getGlProjectPl({
    @Query('period') String? period,
  });

  /// Cashflow (GET ?period=).
  ///
  /// [period] - Accounting period selector (e.g. YYYY-MM).
  @GET('/gl/reports/cashflow')
  Future<Entity> getGlCashflow({
    @Query('period') String? period,
  });

  /// Import bank statement (file) → auto-match
  @MultiPart()
  @POST('/bank/statements/import')
  Future<Entity> importBankStatements({
    @Part(name: 'file') required File file,
  });

  /// Bank reconcile ({period})
  @POST('/bank/reconcile')
  Future<Entity> reconcileBank({
    @Body() required BankReconcileRequestBody body,
  });

  /// Close GL period ({period}) — locks past entries
  @POST('/gl/close-period')
  Future<Entity> closeGlPeriod({
    @Body() required GlClosePeriodRequestBody body,
  });

  /// List fixed assets.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/fa/assets')
  Future<List<Entity>> listFaAssets({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create fixed asset
  @POST('/fa/assets')
  Future<Entity> createFaAsset({
    @Body() required Entity body,
  });

  /// Run depreciation ({month})
  @POST('/fa/run-depreciation')
  Future<Entity> runFaDepreciation({
    @Body() required FaRunDepreciationRequestBody body,
  });

  /// List labor workers.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/labor/workers')
  Future<List<Entity>> listLaborWorkers({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create labor worker
  @POST('/labor/workers')
  Future<Entity> createLaborWorker({
    @Body() required Entity body,
  });

  /// List labor attendance.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/labor/attendance')
  Future<List<Entity>> listLaborAttendance({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Record labor attendance
  @POST('/labor/attendance')
  Future<Entity> createLaborAttendance({
    @Body() required Entity body,
  });

  /// List labor payroll.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/labor/payroll')
  Future<List<Entity>> listLaborPayroll({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create labor payroll run
  @POST('/labor/payroll')
  Future<Entity> createLaborPayroll({
    @Body() required Entity body,
  });

  /// List OPEX budgets (GET ?year=).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/opex/budgets')
  Future<List<Entity>> listOpexBudgets({
    @Query('year') int? year,
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create OPEX budget
  @POST('/opex/budgets')
  Future<Entity> createOpexBudget({
    @Body() required Entity body,
  });

  /// Send e-Tax ({invoice_ids[]})
  @POST('/etax/send')
  Future<Entity> sendEtax({
    @Body() required EtaxSendRequestBody body,
  });

  /// e-Tax status
  @GET('/etax/status')
  Future<Entity> getEtaxStatus();
}
