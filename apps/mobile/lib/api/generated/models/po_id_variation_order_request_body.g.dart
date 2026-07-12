// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'po_id_variation_order_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PoIdVariationOrderRequestBody _$PoIdVariationOrderRequestBodyFromJson(
  Map<String, dynamic> json,
) => PoIdVariationOrderRequestBody(
  dir: json['dir'] as String?,
  amount: json['amount'] as num?,
  reason: json['reason'] as String?,
);

Map<String, dynamic> _$PoIdVariationOrderRequestBodyToJson(
  PoIdVariationOrderRequestBody instance,
) => <String, dynamic>{
  'dir': instance.dir,
  'amount': instance.amount,
  'reason': instance.reason,
};
