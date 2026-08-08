// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'gr_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GrRequestBody _$GrRequestBodyFromJson(Map<String, dynamic> json) =>
    GrRequestBody(
      lines: (json['lines'] as List<dynamic>)
          .map((e) => Lines.fromJson(e as Map<String, dynamic>))
          .toList(),
      poId: json['po_id'] as String?,
      woId: json['wo_id'] as String?,
      idempotencyKey: json['idempotency_key'] as String?,
      warehouseId: json['warehouse_id'] as String?,
    );

Map<String, dynamic> _$GrRequestBodyToJson(GrRequestBody instance) =>
    <String, dynamic>{
      'po_id': instance.poId,
      'wo_id': instance.woId,
      'idempotency_key': instance.idempotencyKey,
      'warehouse_id': instance.warehouseId,
      'lines': instance.lines,
    };
