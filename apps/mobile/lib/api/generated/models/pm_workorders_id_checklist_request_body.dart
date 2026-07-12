// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'items.dart';

part 'pm_workorders_id_checklist_request_body.g.dart';

@JsonSerializable()
class PmWorkordersIdChecklistRequestBody {
  const PmWorkordersIdChecklistRequestBody({
    this.items,
  });
  
  factory PmWorkordersIdChecklistRequestBody.fromJson(Map<String, Object?> json) => _$PmWorkordersIdChecklistRequestBodyFromJson(json);
  
  final List<Items>? items;

  Map<String, Object?> toJson() => _$PmWorkordersIdChecklistRequestBodyToJson(this);
}
