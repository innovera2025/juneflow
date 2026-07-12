// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'etax_send_request_body.g.dart';

@JsonSerializable()
class EtaxSendRequestBody {
  const EtaxSendRequestBody({
    this.invoiceIds,
  });
  
  factory EtaxSendRequestBody.fromJson(Map<String, Object?> json) => _$EtaxSendRequestBodyFromJson(json);
  
  @JsonKey(name: 'invoice_ids')
  final List<String>? invoiceIds;

  Map<String, Object?> toJson() => _$EtaxSendRequestBodyToJson(this);
}
