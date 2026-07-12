// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ar_rv_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ArRvRequestBody _$ArRvRequestBodyFromJson(Map<String, dynamic> json) =>
    ArRvRequestBody(
      invoiceId: json['invoice_id'] as String?,
      amount: json['amount'] as num?,
    );

Map<String, dynamic> _$ArRvRequestBodyToJson(ArRvRequestBody instance) =>
    <String, dynamic>{
      'invoice_id': instance.invoiceId,
      'amount': instance.amount,
    };
