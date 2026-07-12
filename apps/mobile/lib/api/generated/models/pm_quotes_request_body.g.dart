// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pm_quotes_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PmQuotesRequestBody _$PmQuotesRequestBodyFromJson(Map<String, dynamic> json) =>
    PmQuotesRequestBody(
      woId: json['wo_id'] as String?,
      parts: json['parts'] as List<dynamic>?,
    );

Map<String, dynamic> _$PmQuotesRequestBodyToJson(
  PmQuotesRequestBody instance,
) => <String, dynamic>{'wo_id': instance.woId, 'parts': instance.parts};
