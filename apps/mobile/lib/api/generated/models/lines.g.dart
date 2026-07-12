// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'lines.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Lines _$LinesFromJson(Map<String, dynamic> json) => Lines(
  qtyOk: json['qty_ok'] as num?,
  qtyRejected: json['qty_rejected'] as num?,
  photos: (json['photos'] as List<dynamic>?)?.map((e) => e as String).toList(),
);

Map<String, dynamic> _$LinesToJson(Lines instance) => <String, dynamic>{
  'qty_ok': instance.qtyOk,
  'qty_rejected': instance.qtyRejected,
  'photos': instance.photos,
};
