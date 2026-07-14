// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'project_phase.g.dart';

/// A phase row of a project (project_node kind=phase) — B-041(ก+). units = unit-kind nodes under the phase; sold_pct = round(100 × sold-or-transferred sales units / units); sale_status is the phase node's own sale status (nullable free text).
@JsonSerializable()
class ProjectPhase {
  const ProjectPhase({
    required this.id,
    required this.name,
    this.units,
    this.soldPct,
    this.saleStatus,
  });
  
  factory ProjectPhase.fromJson(Map<String, Object?> json) => _$ProjectPhaseFromJson(json);
  
  final String id;
  final String name;
  final int? units;
  @JsonKey(name: 'sold_pct')
  final int? soldPct;
  @JsonKey(name: 'sale_status')
  final String? saleStatus;

  Map<String, Object?> toJson() => _$ProjectPhaseToJson(this);
}
