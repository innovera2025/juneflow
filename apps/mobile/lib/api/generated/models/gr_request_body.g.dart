// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'gr_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GrRequestBody _$GrRequestBodyFromJson(Map<String, dynamic> json) =>
    GrRequestBody(
      poId: json['po_id'] as String,
      lines: (json['lines'] as List<dynamic>)
          .map((e) => Lines.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$GrRequestBodyToJson(GrRequestBody instance) =>
    <String, dynamic>{'po_id': instance.poId, 'lines': instance.lines};
