// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'boq_id_generate_pr_request_body.g.dart';

@JsonSerializable()
class BoqIdGeneratePrRequestBody {
  const BoqIdGeneratePrRequestBody({
    this.itemIds,
    this.qty,
  });
  
  factory BoqIdGeneratePrRequestBody.fromJson(Map<String, Object?> json) => _$BoqIdGeneratePrRequestBodyFromJson(json);
  
  @JsonKey(name: 'item_ids')
  final List<String>? itemIds;
  final dynamic qty;

  Map<String, Object?> toJson() => _$BoqIdGeneratePrRequestBodyToJson(this);
}
