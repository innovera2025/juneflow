// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'entity.g.dart';

/// Opaque resource. Exact fields live in the data-dictionary schema tasks, not in this contract transcription — inventing fields here is forbidden (PLAN.md section 0). Modeled explicitly only where api-contract.md names fields (e.g. AuthLoginInput).
@JsonSerializable()
class Entity {
  const Entity();
  
  factory Entity.fromJson(Map<String, Object?> json) => _$EntityFromJson(json);
  
  Map<String, Object?> toJson() => _$EntityToJson(this);
}
