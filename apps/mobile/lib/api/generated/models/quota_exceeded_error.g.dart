// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'quota_exceeded_error.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

QuotaExceededError _$QuotaExceededErrorFromJson(Map<String, dynamic> json) =>
    QuotaExceededError(
      message: json['message'] as String,
      upgradeUrl: json['upgrade_url'] as String,
      code: json['code'] == null
          ? null
          : QuotaExceededErrorCode.fromJson(json['code'] as String),
    );

Map<String, dynamic> _$QuotaExceededErrorToJson(QuotaExceededError instance) =>
    <String, dynamic>{
      'code': instance.code,
      'message': instance.message,
      'upgrade_url': instance.upgradeUrl,
    };
