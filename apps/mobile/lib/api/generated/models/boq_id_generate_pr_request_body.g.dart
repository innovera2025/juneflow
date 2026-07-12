// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'boq_id_generate_pr_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

BoqIdGeneratePrRequestBody _$BoqIdGeneratePrRequestBodyFromJson(
  Map<String, dynamic> json,
) => BoqIdGeneratePrRequestBody(
  itemIds: (json['item_ids'] as List<dynamic>?)
      ?.map((e) => e as String)
      .toList(),
  qty: json['qty'],
);

Map<String, dynamic> _$BoqIdGeneratePrRequestBodyToJson(
  BoqIdGeneratePrRequestBody instance,
) => <String, dynamic>{'item_ids': instance.itemIds, 'qty': instance.qty};
