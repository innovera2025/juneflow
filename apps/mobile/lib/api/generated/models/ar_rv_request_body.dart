// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'ar_rv_request_body.g.dart';

@JsonSerializable()
class ArRvRequestBody {
  const ArRvRequestBody({
    this.invoiceId,
    this.amount,
  });
  
  factory ArRvRequestBody.fromJson(Map<String, Object?> json) => _$ArRvRequestBodyFromJson(json);
  
  @JsonKey(name: 'invoice_id')
  final String? invoiceId;
  final num? amount;

  Map<String, Object?> toJson() => _$ArRvRequestBodyToJson(this);
}
