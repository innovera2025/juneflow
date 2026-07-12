// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pm_workorders_id_close_request_body.g.dart';

@JsonSerializable()
class PmWorkordersIdCloseRequestBody {
  const PmWorkordersIdCloseRequestBody({
    this.cause,
    this.fix,
    this.advice,
    this.signature,
  });
  
  factory PmWorkordersIdCloseRequestBody.fromJson(Map<String, Object?> json) => _$PmWorkordersIdCloseRequestBodyFromJson(json);
  
  final String? cause;
  final String? fix;
  final String? advice;
  final String? signature;

  Map<String, Object?> toJson() => _$PmWorkordersIdCloseRequestBodyToJson(this);
}
