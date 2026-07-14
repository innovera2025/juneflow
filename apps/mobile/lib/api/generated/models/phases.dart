// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'phases.g.dart';

@JsonSerializable()
class Phases {
  const Phases({
    this.label,
    this.units,
  });
  
  factory Phases.fromJson(Map<String, Object?> json) => _$PhasesFromJson(json);
  
  final String? label;
  final int? units;

  Map<String, Object?> toJson() => _$PhasesToJson(this);
}
