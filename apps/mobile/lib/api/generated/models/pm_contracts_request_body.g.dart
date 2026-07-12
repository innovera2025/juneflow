// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pm_contracts_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PmContractsRequestBody _$PmContractsRequestBodyFromJson(
  Map<String, dynamic> json,
) => PmContractsRequestBody(
  projectId: json['project_id'] as String?,
  mode: json['mode'] == null ? null : Mode.fromJson(json['mode'] as String),
  visitsPerYear: (json['visits_per_year'] as num?)?.toInt(),
  sla: json['sla'] as String?,
);

Map<String, dynamic> _$PmContractsRequestBodyToJson(
  PmContractsRequestBody instance,
) => <String, dynamic>{
  'project_id': instance.projectId,
  'mode': instance.mode,
  'visits_per_year': instance.visitsPerYear,
  'sla': instance.sla,
};
