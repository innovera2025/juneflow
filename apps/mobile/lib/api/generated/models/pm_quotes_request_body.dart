// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pm_quotes_request_body.g.dart';

@JsonSerializable()
class PmQuotesRequestBody {
  const PmQuotesRequestBody({
    this.woId,
    this.parts,
  });
  
  factory PmQuotesRequestBody.fromJson(Map<String, Object?> json) => _$PmQuotesRequestBodyFromJson(json);
  
  @JsonKey(name: 'wo_id')
  final String? woId;
  final List<dynamic>? parts;

  Map<String, Object?> toJson() => _$PmQuotesRequestBodyToJson(this);
}
