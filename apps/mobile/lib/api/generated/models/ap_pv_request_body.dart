// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'ap_pv_request_body.g.dart';

@JsonSerializable()
class ApPvRequestBody {
  const ApPvRequestBody({
    this.billingIds,
    this.whtPct,
  });
  
  factory ApPvRequestBody.fromJson(Map<String, Object?> json) => _$ApPvRequestBodyFromJson(json);
  
  @JsonKey(name: 'billing_ids')
  final List<String>? billingIds;
  @JsonKey(name: 'wht_pct')
  final num? whtPct;

  Map<String, Object?> toJson() => _$ApPvRequestBodyToJson(this);
}
