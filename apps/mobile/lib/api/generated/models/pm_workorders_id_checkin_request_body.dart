// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'pm_workorders_id_checkin_request_body.g.dart';

@JsonSerializable()
class PmWorkordersIdCheckinRequestBody {
  const PmWorkordersIdCheckinRequestBody({
    this.gps,
  });
  
  factory PmWorkordersIdCheckinRequestBody.fromJson(Map<String, Object?> json) => _$PmWorkordersIdCheckinRequestBodyFromJson(json);
  
  final String? gps;

  Map<String, Object?> toJson() => _$PmWorkordersIdCheckinRequestBodyToJson(this);
}
