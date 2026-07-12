// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'defects_id_recheck_request_body.g.dart';

@JsonSerializable()
class DefectsIdRecheckRequestBody {
  const DefectsIdRecheckRequestBody({
    this.result,
  });
  
  factory DefectsIdRecheckRequestBody.fromJson(Map<String, Object?> json) => _$DefectsIdRecheckRequestBodyFromJson(json);
  
  final String? result;

  Map<String, Object?> toJson() => _$DefectsIdRecheckRequestBodyToJson(this);
}
