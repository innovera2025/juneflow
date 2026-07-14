// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_projects_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetProjectsResponse _$GetProjectsResponseFromJson(Map<String, dynamic> json) =>
    GetProjectsResponse(
      page: (json['page'] as num).toInt(),
      pageSize: (json['page_size'] as num).toInt(),
      total: (json['total'] as num).toInt(),
      data: (json['data'] as List<dynamic>?)
          ?.map((e) => Project.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetProjectsResponseToJson(
  GetProjectsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'page': instance.page,
  'page_size': instance.pageSize,
  'total': instance.total,
};
