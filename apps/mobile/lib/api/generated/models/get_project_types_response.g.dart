// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_project_types_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetProjectTypesResponse _$GetProjectTypesResponseFromJson(
  Map<String, dynamic> json,
) => GetProjectTypesResponse(
  page: (json['page'] as num).toInt(),
  pageSize: (json['page_size'] as num).toInt(),
  total: (json['total'] as num).toInt(),
  data: (json['data'] as List<dynamic>?)
      ?.map((e) => Entity.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetProjectTypesResponseToJson(
  GetProjectTypesResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'page': instance.page,
  'page_size': instance.pageSize,
  'total': instance.total,
};
