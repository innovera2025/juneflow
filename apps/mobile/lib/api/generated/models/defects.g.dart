// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'defects.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Defects _$DefectsFromJson(Map<String, dynamic> json) => Defects(
  item: json['item'] as String?,
  severity: json['severity'] as String?,
  photoBefore: json['photo_before'] as String?,
);

Map<String, dynamic> _$DefectsToJson(Defects instance) => <String, dynamic>{
  'item': instance.item,
  'severity': instance.severity,
  'photo_before': instance.photoBefore,
};
