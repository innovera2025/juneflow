// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ap_billing_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ApBillingRequestBody _$ApBillingRequestBodyFromJson(
  Map<String, dynamic> json,
) => ApBillingRequestBody(
  poId: json['po_id'] as String?,
  grId: json['gr_id'] as String?,
  invoiceNo: json['invoice_no'] as String?,
);

Map<String, dynamic> _$ApBillingRequestBodyToJson(
  ApBillingRequestBody instance,
) => <String, dynamic>{
  'po_id': instance.poId,
  'gr_id': instance.grId,
  'invoice_no': instance.invoiceNo,
};
