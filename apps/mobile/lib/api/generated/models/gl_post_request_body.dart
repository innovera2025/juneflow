// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'gl_post_request_body.g.dart';

@JsonSerializable()
class GlPostRequestBody {
  const GlPostRequestBody({
    this.docIds,
  });
  
  factory GlPostRequestBody.fromJson(Map<String, Object?> json) => _$GlPostRequestBodyFromJson(json);
  
  @JsonKey(name: 'doc_ids')
  final List<String>? docIds;

  Map<String, Object?> toJson() => _$GlPostRequestBodyToJson(this);
}
