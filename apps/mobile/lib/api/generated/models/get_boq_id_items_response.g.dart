// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_boq_id_items_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetBoqIdItemsResponse _$GetBoqIdItemsResponseFromJson(
  Map<String, dynamic> json,
) => GetBoqIdItemsResponse(
  page: (json['page'] as num).toInt(),
  pageSize: (json['page_size'] as num).toInt(),
  total: (json['total'] as num).toInt(),
  data: (json['data'] as List<dynamic>?)
      ?.map((e) => Entity.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$GetBoqIdItemsResponseToJson(
  GetBoqIdItemsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'page': instance.page,
  'page_size': instance.pageSize,
  'total': instance.total,
};
