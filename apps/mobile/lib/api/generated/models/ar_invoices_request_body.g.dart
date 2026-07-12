// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ar_invoices_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ArInvoicesRequestBody _$ArInvoicesRequestBodyFromJson(
  Map<String, dynamic> json,
) => ArInvoicesRequestBody(
  customerId: json['customer_id'] as String?,
  lines: json['lines'] as List<dynamic>?,
  creditTerm: json['credit_term'] as String?,
);

Map<String, dynamic> _$ArInvoicesRequestBodyToJson(
  ArInvoicesRequestBody instance,
) => <String, dynamic>{
  'customer_id': instance.customerId,
  'lines': instance.lines,
  'credit_term': instance.creditTerm,
};
