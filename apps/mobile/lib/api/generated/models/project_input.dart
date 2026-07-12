// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'project_input_type.dart';

part 'project_input.g.dart';

/// Project create/update input (fields per data-dictionary).
@JsonSerializable()
class ProjectInput {
  const ProjectInput({
    required this.name,
    required this.type,
    this.budget,
    this.currencyCode,
  });
  
  factory ProjectInput.fromJson(Map<String, Object?> json) => _$ProjectInputFromJson(json);
  
  final String name;
  final ProjectInputType type;
  final num? budget;
  @JsonKey(name: 'currency_code')
  final String? currencyCode;

  Map<String, Object?> toJson() => _$ProjectInputToJson(this);
}
