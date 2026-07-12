// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'quota_exceeded_error_code.dart';

part 'quota_exceeded_error.g.dart';

@JsonSerializable()
class QuotaExceededError {
  const QuotaExceededError({
    required this.message,
    required this.upgradeUrl,
    this.code,
  });
  
  factory QuotaExceededError.fromJson(Map<String, Object?> json) => _$QuotaExceededErrorFromJson(json);
  
  final QuotaExceededErrorCode? code;
  final String message;
  @JsonKey(name: 'upgrade_url')
  final String upgradeUrl;

  Map<String, Object?> toJson() => _$QuotaExceededErrorToJson(this);
}
