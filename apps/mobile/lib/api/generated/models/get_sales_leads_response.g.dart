// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_sales_leads_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetSalesLeadsResponse _$GetSalesLeadsResponseFromJson(
  Map<String, dynamic> json,
) => GetSalesLeadsResponse(
  page: (json['page'] as num).toInt(),
  pageSize: (json['page_size'] as num).toInt(),
  total: (json['total'] as num).toInt(),
  data: (json['data'] as List<dynamic>?)
      ?.map((e) => Entity.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetSalesLeadsResponseToJson(
  GetSalesLeadsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'page': instance.page,
  'page_size': instance.pageSize,
  'total': instance.total,
};
