// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'phases.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Phases _$PhasesFromJson(Map<String, dynamic> json) => Phases(
  label: json['label'] as String?,
  units: (json['units'] as num?)?.toInt(),
);

Map<String, dynamic> _$PhasesToJson(Phases instance) => <String, dynamic>{
  'label': instance.label,
  'units': instance.units,
};
