// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'periods_id_inspect_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PeriodsIdInspectRequestBody _$PeriodsIdInspectRequestBodyFromJson(
  Map<String, dynamic> json,
) => PeriodsIdInspectRequestBody(
  result: Result.fromJson(json['result'] as String),
  defects: (json['defects'] as List<dynamic>?)
      ?.map((e) => Defects.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$PeriodsIdInspectRequestBodyToJson(
  PeriodsIdInspectRequestBody instance,
) => <String, dynamic>{'result': instance.result, 'defects': instance.defects};
