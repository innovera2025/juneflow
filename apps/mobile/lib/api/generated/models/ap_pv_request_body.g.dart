// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ap_pv_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApPvRequestBody _$ApPvRequestBodyFromJson(Map<String, dynamic> json) =>
    ApPvRequestBody(
      billingIds: (json['billing_ids'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      whtPct: json['wht_pct'] as num?,
    );

Map<String, dynamic> _$ApPvRequestBodyToJson(ApPvRequestBody instance) =>
    <String, dynamic>{
      'billing_ids': instance.billingIds,
      'wht_pct': instance.whtPct,
    };
