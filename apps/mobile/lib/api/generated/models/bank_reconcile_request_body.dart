// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'bank_reconcile_request_body.g.dart';

@JsonSerializable()
class BankReconcileRequestBody {
  const BankReconcileRequestBody({
    this.period,
  });
  
  factory BankReconcileRequestBody.fromJson(Map<String, Object?> json) => _$BankReconcileRequestBodyFromJson(json);
  
  final String? period;

  Map<String, Object?> toJson() => _$BankReconcileRequestBodyToJson(this);
}
