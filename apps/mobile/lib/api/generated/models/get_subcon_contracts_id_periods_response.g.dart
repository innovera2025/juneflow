// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'get_subcon_contracts_id_periods_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GetSubconContractsIdPeriodsResponse
_$GetSubconContractsIdPeriodsResponseFromJson(Map<String, dynamic> json) =>
    GetSubconContractsIdPeriodsResponse(
      page: (json['page'] as num).toInt(),
      pageSize: (json['page_size'] as num).toInt(),
      total: (json['total'] as num).toInt(),
      data: (json['data'] as List<dynamic>?)
          ?.map((e) => Entity.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GetSubconContractsIdPeriodsResponseToJson(
  GetSubconContractsIdPeriodsResponse instance,
) => <String, dynamic>{
  'data': instance.data,
  'page': instance.page,
  'page_size': instance.pageSize,
  'total': instance.total,
};
