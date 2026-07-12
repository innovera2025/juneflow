// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'ai_qto_job_create_boq_request_body.g.dart';

@JsonSerializable()
class AiQtoJobCreateBoqRequestBody {
  const AiQtoJobCreateBoqRequestBody({
    this.mappings,
  });
  
  factory AiQtoJobCreateBoqRequestBody.fromJson(Map<String, Object?> json) => _$AiQtoJobCreateBoqRequestBodyFromJson(json);
  
  final List<dynamic>? mappings;

  Map<String, Object?> toJson() => _$AiQtoJobCreateBoqRequestBodyToJson(this);
}
