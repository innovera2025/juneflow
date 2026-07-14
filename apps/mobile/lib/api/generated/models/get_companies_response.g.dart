// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_companies_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetCompaniesResponse _$GetCompaniesResponseFromJson(
  Map<String, dynamic> json,
) => GetCompaniesResponse(
  page: (json['page'] as num).toInt(),
  pageSize: (json['page_size'] as num).toInt(),
  total: (json['total'] as num).toInt(),
  data: (json['data'] as List<dynamic>?)
      ?.map((e) => Company.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetCompaniesResponseToJson(
  GetCompaniesResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'page': instance.page,
  'page_size': instance.pageSize,
  'total': instance.total,
};
