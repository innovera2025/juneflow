// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'ap_billing_request_body.g.dart';

@JsonSerializable()
class ApBillingRequestBody {
  const ApBillingRequestBody({
    this.poId,
    this.grId,
    this.invoiceNo,
  });
  
  factory ApBillingRequestBody.fromJson(Map<String, Object?> json) => _$ApBillingRequestBodyFromJson(json);
  
  @JsonKey(name: 'po_id')
  final String? poId;
  @JsonKey(name: 'gr_id')
  final String? grId;
  @JsonKey(name: 'invoice_no')
  final String? invoiceNo;

  Map<String, Object?> toJson() => _$ApBillingRequestBodyToJson(this);
}
