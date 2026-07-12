// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';

import 'clients/auth_api.dart';
import 'clients/admin_api.dart';
import 'clients/master_api.dart';
import 'clients/boq_api.dart';
import 'clients/subcon_api.dart';
import 'clients/pm_api.dart';
import 'clients/finance_api.dart';
import 'clients/land_sales_api.dart';
import 'clients/dms_api.dart';
import 'clients/files_api.dart';
import 'clients/exports_api.dart';
import 'clients/line_api.dart';

/// Juneflow API `v0.1.0`.
///
/// Construction ERP + Subscription SaaS (multi-tenant). REST, JSON, prefix /api/v1. Every request carries "Authorization: Bearer <jwt>"; the JWT carries company_id (tenant scope). Status changes go through action endpoints only, never direct PUT.
class JuneflowApiClient {
  JuneflowApiClient(
    Dio dio, {
    String? baseUrl,
  })  : _dio = dio,
        _baseUrl = baseUrl;

  final Dio _dio;
  final String? _baseUrl;

  static String get version => '0.1.0';

  AuthApi? _auth;
  AdminApi? _admin;
  MasterApi? _master;
  BoqApi? _boq;
  SubconApi? _subcon;
  PmApi? _pm;
  FinanceApi? _finance;
  LandSalesApi? _landSales;
  DmsApi? _dms;
  FilesApi? _files;
  ExportsApi? _exports;
  LineApi? _line;

  AuthApi get auth => _auth ??= AuthApi(_dio, baseUrl: _baseUrl);

  AdminApi get admin => _admin ??= AdminApi(_dio, baseUrl: _baseUrl);

  MasterApi get master => _master ??= MasterApi(_dio, baseUrl: _baseUrl);

  BoqApi get boq => _boq ??= BoqApi(_dio, baseUrl: _baseUrl);

  SubconApi get subcon => _subcon ??= SubconApi(_dio, baseUrl: _baseUrl);

  PmApi get pm => _pm ??= PmApi(_dio, baseUrl: _baseUrl);

  FinanceApi get finance => _finance ??= FinanceApi(_dio, baseUrl: _baseUrl);

  LandSalesApi get landSales => _landSales ??= LandSalesApi(_dio, baseUrl: _baseUrl);

  DmsApi get dms => _dms ??= DmsApi(_dio, baseUrl: _baseUrl);

  FilesApi get files => _files ??= FilesApi(_dio, baseUrl: _baseUrl);

  ExportsApi get exports => _exports ??= ExportsApi(_dio, baseUrl: _baseUrl);

  LineApi get line => _line ??= LineApi(_dio, baseUrl: _baseUrl);
}
