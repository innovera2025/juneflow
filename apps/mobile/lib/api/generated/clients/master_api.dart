// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';
import '../models/get_companies_response.dart';
import '../models/get_cost_centers_response.dart';
import '../models/get_customers_response.dart';
import '../models/get_doc_numbering_response.dart';
import '../models/get_models_response.dart';
import '../models/get_org_units_response.dart';
import '../models/get_project_types_response.dart';
import '../models/get_projects_id_hierarchy_response.dart';
import '../models/get_projects_response.dart';
import '../models/get_vendors_response.dart';
import '../models/kind.dart';
import '../models/project.dart';
import '../models/project_input.dart';

part 'master_api.g.dart';

@RestApi()
abstract class MasterApi {
  factory MasterApi(Dio dio, {String? baseUrl}) = _MasterApi;

  /// List the tenant's affiliated group companies (Multi-Company).
  ///
  /// B-041(ก+): the บริษัทในเครือ rows behind the CompanySwitcher (company-accept.jsx COMPANIES / PLAN.md Appendix B item 14). Returns the members of the tenant's company group — companies linked via group_parent_id to the tenant's group head. Tenant-scoped: a tenant can only ever see its own group.
  @GET('/companies')
  Future<GetCompaniesResponse> listCompanies();

  /// List projects (GET /x?filter&page pattern).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  ///
  /// [pageSize] - Rows per page (B-014). Server applies a default when omitted.
  @GET('/projects')
  Future<GetProjectsResponse> listProjects({
    @Query('filter') String? filter,
    @Query('page') int? page,
    @Query('page_size') int? pageSize,
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
  Future<GetProjectsIdHierarchyResponse> getProjectHierarchy({
    @Path('id') required String id,
  });

  /// List org structure nodes (flat ordered tree, lvl 0-2).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/org-units')
  Future<GetOrgUnitsResponse> listOrgUnits({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create org node (company lvl0 or department/team lvl 1-2)
  @POST('/org-units')
  Future<Entity> createOrgUnit({
    @Body() required Entity body,
  });

  /// Update org node (partial merge - omitted fields keep current values)
  @PUT('/org-units/{id}')
  Future<Entity> updateOrgUnit({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// Delete org node (cascades to the whole subtree)
  @DELETE('/org-units/{id}')
  Future<Entity> deleteOrgUnit({
    @Path('id') required String id,
  });

  /// Create block node under the first/active phase (auto-generates N unit nodes, status empty, max 200)
  @POST('/projects/{id}/nodes')
  Future<Entity> createProjectNode({
    @Path('id') required String id,
    @Body() required Entity body,
  });

  /// List project types (hierarchy[], modules{} — Full only).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/project-types')
  Future<GetProjectTypesResponse> listProjectTypes({
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
  Future<GetVendorsResponse> listVendors({
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
  Future<GetCustomersResponse> listCustomers({
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
  Future<GetCostCentersResponse> listCostCenters({
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
  Future<GetDocNumberingResponse> listDocNumbering({
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

  /// List house models (GET /models?filter&page).
  ///
  /// [filter] - Free-text/structured filter (GET /x?filter&page pattern).
  ///
  /// [page] - 1-based page index (GET /x?filter&page pattern).
  @GET('/models')
  Future<GetModelsResponse> listModels({
    @Query('filter') String? filter,
    @Query('page') int? page,
  });

  /// Create house model (new model starts as draft)
  @POST('/models')
  Future<Entity> createModel({
    @Body() required Entity body,
  });
}
