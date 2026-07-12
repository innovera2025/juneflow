// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'periods_id_deliver_request_body.g.dart';

@JsonSerializable()
class PeriodsIdDeliverRequestBody {
  const PeriodsIdDeliverRequestBody({
    this.docs,
    this.photos,
  });
  
  factory PeriodsIdDeliverRequestBody.fromJson(Map<String, Object?> json) => _$PeriodsIdDeliverRequestBodyFromJson(json);
  
  final List<String>? docs;
  final List<String>? photos;

  Map<String, Object?> toJson() => _$PeriodsIdDeliverRequestBodyToJson(this);
}
