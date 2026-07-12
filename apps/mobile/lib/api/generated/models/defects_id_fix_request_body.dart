// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'defects_id_fix_request_body.g.dart';

@JsonSerializable()
class DefectsIdFixRequestBody {
  const DefectsIdFixRequestBody({
    this.photoAfter,
  });
  
  factory DefectsIdFixRequestBody.fromJson(Map<String, Object?> json) => _$DefectsIdFixRequestBodyFromJson(json);
  
  @JsonKey(name: 'photo_after')
  final String? photoAfter;

  Map<String, Object?> toJson() => _$DefectsIdFixRequestBodyToJson(this);
}
