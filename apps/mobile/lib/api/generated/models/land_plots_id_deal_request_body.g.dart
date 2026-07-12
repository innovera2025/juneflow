// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'land_plots_id_deal_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LandPlotsIdDealRequestBody _$LandPlotsIdDealRequestBodyFromJson(
  Map<String, dynamic> json,
) => LandPlotsIdDealRequestBody(
  type: json['type'] == null ? null : Type2.fromJson(json['type'] as String),
  terms: json['terms'],
);

Map<String, dynamic> _$LandPlotsIdDealRequestBodyToJson(
  LandPlotsIdDealRequestBody instance,
) => <String, dynamic>{'type': instance.type, 'terms': instance.terms};
