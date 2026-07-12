// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pm_workorders_id_close_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PmWorkordersIdCloseRequestBody _$PmWorkordersIdCloseRequestBodyFromJson(
  Map<String, dynamic> json,
) => PmWorkordersIdCloseRequestBody(
  cause: json['cause'] as String?,
  fix: json['fix'] as String?,
  advice: json['advice'] as String?,
  signature: json['signature'] as String?,
);

Map<String, dynamic> _$PmWorkordersIdCloseRequestBodyToJson(
  PmWorkordersIdCloseRequestBody instance,
) => <String, dynamic>{
  'cause': instance.cause,
  'fix': instance.fix,
  'advice': instance.advice,
  'signature': instance.signature,
};
