// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'ar_invoices_request_body.g.dart';

@JsonSerializable()
class ArInvoicesRequestBody {
  const ArInvoicesRequestBody({
    this.customerId,
    this.lines,
    this.creditTerm,
  });
  
  factory ArInvoicesRequestBody.fromJson(Map<String, Object?> json) => _$ArInvoicesRequestBodyFromJson(json);
  
  @JsonKey(name: 'customer_id')
  final String? customerId;
  final List<dynamic>? lines;
  @JsonKey(name: 'credit_term')
  final String? creditTerm;

  Map<String, Object?> toJson() => _$ArInvoicesRequestBodyToJson(this);
}
