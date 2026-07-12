// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'type2.dart';

part 'land_plots_id_deal_request_body.g.dart';

@JsonSerializable()
class LandPlotsIdDealRequestBody {
  const LandPlotsIdDealRequestBody({
    this.type,
    this.terms,
  });
  
  factory LandPlotsIdDealRequestBody.fromJson(Map<String, Object?> json) => _$LandPlotsIdDealRequestBodyFromJson(json);
  
  final Type2? type;
  final dynamic terms;

  Map<String, Object?> toJson() => _$LandPlotsIdDealRequestBodyToJson(this);
}
