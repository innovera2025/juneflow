// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'project_phase.dart';
import 'project_type.dart';

part 'project.g.dart';

/// Minimal placeholder per data-dictionary Project (name, type, budget, status). Full field modeling belongs to the schema tasks. short / color / company_id / units / phases are the B-041(ก+) approved ProjectSwitcher extensions (chrome.jsx PROJECTS): short/color are stamped master columns (migration 0009); company_id is the owning company; units / phases are derived from project_node + sales_unit.
@JsonSerializable()
class Project {
  const Project({
    required this.id,
    required this.name,
    required this.type,
    required this.status,
    this.budget,
    this.currencyCode,
    this.short,
    this.color,
    this.companyId,
    this.units,
    this.phases,
  });
  
  factory Project.fromJson(Map<String, Object?> json) => _$ProjectFromJson(json);
  
  final String id;
  final String name;
  final ProjectType type;
  final num? budget;

  /// Every money value carries currency_code (PLAN.md section 4).
  @JsonKey(name: 'currency_code')
  final String? currencyCode;
  final String status;
  final String? short;
  final String? color;
  @JsonKey(name: 'company_id')
  final String? companyId;
  final int? units;
  final List<ProjectPhase>? phases;

  Map<String, Object?> toJson() => _$ProjectToJson(this);
}
