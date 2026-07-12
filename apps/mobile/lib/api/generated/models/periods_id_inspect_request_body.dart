// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'result.dart';
import 'defects.dart';

part 'periods_id_inspect_request_body.g.dart';

@JsonSerializable()
class PeriodsIdInspectRequestBody {
  const PeriodsIdInspectRequestBody({
    required this.result,
    this.defects,
  });
  
  factory PeriodsIdInspectRequestBody.fromJson(Map<String, Object?> json) => _$PeriodsIdInspectRequestBodyFromJson(json);
  
  final Result result;
  final List<Defects>? defects;

  Map<String, Object?> toJson() => _$PeriodsIdInspectRequestBodyToJson(this);
}
