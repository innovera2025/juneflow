// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'lines.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Lines _$LinesFromJson(Map<String, dynamic> json) => Lines(
  qtyOk: json['qty_ok'] as num?,
  qtyRejected: json['qty_rejected'] as num?,
  itemId: json['item_id'] as String?,
  boqItemId: json['boq_item_id'] as String?,
  name: json['name'] as String?,
  orderedQty: json['ordered_qty'] as num?,
  unit: json['unit'] as String?,
  price: json['price'] as num?,
  photos: (json['photos'] as List<dynamic>?)?.map((e) => e as String).toList(),
);

Map<String, dynamic> _$LinesToJson(Lines instance) => <String, dynamic>{
  'qty_ok': instance.qtyOk,
  'qty_rejected': instance.qtyRejected,
  'item_id': instance.itemId,
  'boq_item_id': instance.boqItemId,
  'name': instance.name,
  'ordered_qty': instance.orderedQty,
  'unit': instance.unit,
  'price': instance.price,
  'photos': instance.photos,
};
