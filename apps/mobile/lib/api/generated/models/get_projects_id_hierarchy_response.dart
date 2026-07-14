// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hierarchy_node.dart';

part 'get_projects_id_hierarchy_response.g.dart';

@JsonSerializable()
class GetProjectsIdHierarchyResponse {
  const GetProjectsIdHierarchyResponse({
    required this.data,
  });
  
  factory GetProjectsIdHierarchyResponse.fromJson(Map<String, Object?> json) => _$GetProjectsIdHierarchyResponseFromJson(json);
  
  final List<HierarchyNode> data;

  Map<String, Object?> toJson() => _$GetProjectsIdHierarchyResponseToJson(this);
}
