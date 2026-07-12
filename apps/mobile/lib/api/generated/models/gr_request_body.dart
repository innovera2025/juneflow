// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lines.dart';

part 'gr_request_body.g.dart';

@JsonSerializable()
class GrRequestBody {
  const GrRequestBody({
    required this.poId,
    required this.lines,
  });
  
  factory GrRequestBody.fromJson(Map<String, Object?> json) => _$GrRequestBodyFromJson(json);
  
  @JsonKey(name: 'po_id')
  final String poId;
  final List<Lines> lines;

  Map<String, Object?> toJson() => _$GrRequestBodyToJson(this);
}
