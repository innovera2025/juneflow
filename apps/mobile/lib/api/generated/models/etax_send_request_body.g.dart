// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'etax_send_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EtaxSendRequestBody _$EtaxSendRequestBodyFromJson(Map<String, dynamic> json) =>
    EtaxSendRequestBody(
      invoiceIds: (json['invoice_ids'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$EtaxSendRequestBodyToJson(
  EtaxSendRequestBody instance,
) => <String, dynamic>{'invoice_ids': instance.invoiceIds};
