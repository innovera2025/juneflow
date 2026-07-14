// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'paginated.dart';
import 'project.dart';

part 'get_projects_response.g.dart';

@JsonSerializable()
class GetProjectsResponse {
  const GetProjectsResponse({
    required this.page,
    required this.pageSize,
    required this.total,
    this.data,
  });
  
  factory GetProjectsResponse.fromJson(Map<String, Object?> json) => _$GetProjectsResponseFromJson(json);
  
  final List<Project>? data;
  final int page;
  @JsonKey(name: 'page_size')
  final int pageSize;
  final int total;

  Map<String, Object?> toJson() => _$GetProjectsResponseToJson(this);
}
