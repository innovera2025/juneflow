// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'gl_close_period_request_body.g.dart';

@JsonSerializable()
class GlClosePeriodRequestBody {
  const GlClosePeriodRequestBody({
    this.period,
  });
  
  factory GlClosePeriodRequestBody.fromJson(Map<String, Object?> json) => _$GlClosePeriodRequestBodyFromJson(json);
  
  final String? period;

  Map<String, Object?> toJson() => _$GlClosePeriodRequestBodyToJson(this);
}
