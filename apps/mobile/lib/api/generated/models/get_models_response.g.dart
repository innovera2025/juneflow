// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_models_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetModelsResponse _$GetModelsResponseFromJson(Map<String, dynamic> json) =>
    GetModelsResponse(
      page: (json['page'] as num).toInt(),
      pageSize: (json['page_size'] as num).toInt(),
      total: (json['total'] as num).toInt(),
      data: (json['data'] as List<dynamic>?)
          ?.map((e) => Entity.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetModelsResponseToJson(GetModelsResponse instance) =>
    <String, dynamic>{
      'data': instance.data,
      'page': instance.page,
      'page_size': instance.pageSize,
      'total': instance.total,
    };
