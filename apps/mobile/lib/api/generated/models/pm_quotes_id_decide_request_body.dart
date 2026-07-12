// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pm_quotes_id_decide_request_body.g.dart';

@JsonSerializable()
class PmQuotesIdDecideRequestBody {
  const PmQuotesIdDecideRequestBody({
    this.approve,
  });
  
  factory PmQuotesIdDecideRequestBody.fromJson(Map<String, Object?> json) => _$PmQuotesIdDecideRequestBodyFromJson(json);
  
  final bool? approve;

  Map<String, Object?> toJson() => _$PmQuotesIdDecideRequestBodyToJson(this);
}
