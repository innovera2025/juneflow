// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'exports_request_body.g.dart';

@JsonSerializable()
class ExportsRequestBody {
  const ExportsRequestBody({
    required this.type,
    this.params,
  });
  
  factory ExportsRequestBody.fromJson(Map<String, Object?> json) => _$ExportsRequestBodyFromJson(json);
  
  final String type;
  final dynamic params;

  Map<String, Object?> toJson() => _$ExportsRequestBodyToJson(this);
}
