// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_projects_id_hierarchy_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetProjectsIdHierarchyResponse _$GetProjectsIdHierarchyResponseFromJson(
  Map<String, dynamic> json,
) => GetProjectsIdHierarchyResponse(
  data: (json['data'] as List<dynamic>)
      .map((e) => HierarchyNode.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetProjectsIdHierarchyResponseToJson(
  GetProjectsIdHierarchyResponse instance,
) => <String, dynamic>{'data': instance.data};
