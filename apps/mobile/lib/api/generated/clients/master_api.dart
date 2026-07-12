// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';
import '../models/kind.dart';
import '../models/project.dart';
import '../models/project_input.dart';

part 'master_api.g.dart';

@RestApi()
abstract class MasterApi {
  factory MasterApi(Dio dio, {String? baseUrl}) = _MasterApi;

  /// List projects (GET /x?filter&page pattern).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/projects')
  Future<List<Project>> listProjects({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create project (POST /x pattern)
  @POST('/projects')
  Future<Project> createProject({
    @Body() required ProjectInput body,
  });

  /// Get project by id (GET /x/:id pattern)
  @GET('/projects/{id}')
  Future<Project> getProject({
    @Path('id') required String id,
  });

  /// Update project (PUT /x/:id — never changes status).
  ///
  /// Status transitions are NOT allowed here — use action endpoints (see /boq/{id}/approve).
  @PUT('/projects/{id}')
  Future<Project> updateProject({
    @Path('id') required String id,
    @Body() required ProjectInput body,
  });

  /// Project hierarchy tree (phase/block/unit)
  @GET('/projects/{id}/hierarchy')
  Future<Entity> getProjectHierarchy({
    @Path('id') required String id,
  });

  /// List project types (hierarchy[], modules{} — Full only).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/project-types')
  Future<List<Entity>> listProjectTypes({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create project type
  @POST('/project-types')
  Future<Entity> createProjectType({
    @Body() required Entity body,
  });

  /// Get project type by id
  @GET('/project-types/{id}')
  Future<Entity> getProjectType({
    @Path('id') required String id,
  });

  /// Update project type
  @PUT('/project-types/{id}')
  Future<Entity> updateProjectType({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// List vendors (GET /vendors?kind=supplier|subcon).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/vendors')
  Future<List<Entity>> listVendors({
    @Query('kind') Kind? kind,
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create vendor
  @POST('/vendors')
  Future<Entity> createVendor({
    @Body() required Entity body,
  });

  /// Get vendor by id
  @GET('/vendors/{id}')
  Future<Entity> getVendor({
    @Path('id') required String id,
  });

  /// Update vendor
  @PUT('/vendors/{id}')
  Future<Entity> updateVendor({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// List customers.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/customers')
  Future<List<Entity>> listCustomers({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create customer
  @POST('/customers')
  Future<Entity> createCustomer({
    @Body() required Entity body,
  });

  /// Get customer by id
  @GET('/customers/{id}')
  Future<Entity> getCustomer({
    @Path('id') required String id,
  });

  /// Update customer
  @PUT('/customers/{id}')
  Future<Entity> updateCustomer({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// List cost centers.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/cost-centers')
  Future<List<Entity>> listCostCenters({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create cost center
  @POST('/cost-centers')
  Future<Entity> createCostCenter({
    @Body() required Entity body,
  });

  /// Get cost center by id
  @GET('/cost-centers/{id}')
  Future<Entity> getCostCenter({
    @Path('id') required String id,
  });

  /// Update cost center
  @PUT('/cost-centers/{id}')
  Future<Entity> updateCostCenter({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// List doc-numbering rules.
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/doc-numbering')
  Future<List<Entity>> listDocNumbering({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create doc-numbering rule
  @POST('/doc-numbering')
  Future<Entity> createDocNumbering({
    @Body() required Entity body,
  });

  /// Get doc-numbering rule by id
  @GET('/doc-numbering/{id}')
  Future<Entity> getDocNumbering({
    @Path('id') required String id,
  });

  /// Update doc-numbering rule
  @PUT('/doc-numbering/{id}')
  Future<Entity> updateDocNumbering({
    @Path('id') required String id,
    @Body() required Entity body,
  });
}
