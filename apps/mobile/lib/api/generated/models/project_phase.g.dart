// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'project_phase.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ProjectPhase _$ProjectPhaseFromJson(Map<String, dynamic> json) => ProjectPhase(
  id: json['id'] as String,
  name: json['name'] as String,
  units: (json['units'] as num?)?.toInt(),
  soldPct: (json['sold_pct'] as num?)?.toInt(),
  saleStatus: json['sale_status'] as String?,
);

Map<String, dynamic> _$ProjectPhaseToJson(ProjectPhase instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'units': instance.units,
      'sold_pct': instance.soldPct,
      'sale_status': instance.saleStatus,
    };
