// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'periods_id_deliver_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PeriodsIdDeliverRequestBody _$PeriodsIdDeliverRequestBodyFromJson(
  Map<String, dynamic> json,
) => PeriodsIdDeliverRequestBody(
  docs: (json['docs'] as List<dynamic>?)?.map((e) => e as String).toList(),
  photos: (json['photos'] as List<dynamic>?)?.map((e) => e as String).toList(),
);

Map<String, dynamic> _$PeriodsIdDeliverRequestBodyToJson(
  PeriodsIdDeliverRequestBody instance,
) => <String, dynamic>{'docs': instance.docs, 'photos': instance.photos};
