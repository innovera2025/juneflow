// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'fa_run_depreciation_request_body.g.dart';

@JsonSerializable()
class FaRunDepreciationRequestBody {
  const FaRunDepreciationRequestBody({
    this.month,
  });
  
  factory FaRunDepreciationRequestBody.fromJson(Map<String, Object?> json) => _$FaRunDepreciationRequestBodyFromJson(json);
  
  final String? month;

  Map<String, Object?> toJson() => _$FaRunDepreciationRequestBodyToJson(this);
}
