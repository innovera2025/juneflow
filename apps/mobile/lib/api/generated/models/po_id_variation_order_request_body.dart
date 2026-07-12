// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'po_id_variation_order_request_body.g.dart';

@JsonSerializable()
class PoIdVariationOrderRequestBody {
  const PoIdVariationOrderRequestBody({
    this.dir,
    this.amount,
    this.reason,
  });
  
  factory PoIdVariationOrderRequestBody.fromJson(Map<String, Object?> json) => _$PoIdVariationOrderRequestBodyFromJson(json);
  
  final String? dir;
  final num? amount;
  final String? reason;

  Map<String, Object?> toJson() => _$PoIdVariationOrderRequestBodyToJson(this);
}
