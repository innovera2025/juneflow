// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'land_plots_id_dd_request_body.g.dart';

@JsonSerializable()
class LandPlotsIdDdRequestBody {
  const LandPlotsIdDdRequestBody({
    this.checklist,
  });
  
  factory LandPlotsIdDdRequestBody.fromJson(Map<String, Object?> json) => _$LandPlotsIdDdRequestBodyFromJson(json);
  
  final dynamic checklist;

  Map<String, Object?> toJson() => _$LandPlotsIdDdRequestBodyToJson(this);
}
