// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'defects.g.dart';

@JsonSerializable()
class Defects {
  const Defects({
    this.item,
    this.severity,
    this.photoBefore,
  });
  
  factory Defects.fromJson(Map<String, Object?> json) => _$DefectsFromJson(json);
  
  final String? item;
  final String? severity;
  @JsonKey(name: 'photo_before')
  final String? photoBefore;

  Map<String, Object?> toJson() => _$DefectsToJson(this);
}
