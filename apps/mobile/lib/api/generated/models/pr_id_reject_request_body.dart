// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pr_id_reject_request_body.g.dart';

@JsonSerializable()
class PrIdRejectRequestBody {
  const PrIdRejectRequestBody({
    required this.reason,
  });
  
  factory PrIdRejectRequestBody.fromJson(Map<String, Object?> json) => _$PrIdRejectRequestBodyFromJson(json);
  
  final String reason;

  Map<String, Object?> toJson() => _$PrIdRejectRequestBodyToJson(this);
}
