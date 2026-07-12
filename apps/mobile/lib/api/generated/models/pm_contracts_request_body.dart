// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'mode.dart';

part 'pm_contracts_request_body.g.dart';

@JsonSerializable()
class PmContractsRequestBody {
  const PmContractsRequestBody({
    this.projectId,
    this.mode,
    this.visitsPerYear,
    this.sla,
  });
  
  factory PmContractsRequestBody.fromJson(Map<String, Object?> json) => _$PmContractsRequestBodyFromJson(json);
  
  @JsonKey(name: 'project_id')
  final String? projectId;
  final Mode? mode;
  @JsonKey(name: 'visits_per_year')
  final int? visitsPerYear;
  final String? sla;

  Map<String, Object?> toJson() => _$PmContractsRequestBodyToJson(this);
}
