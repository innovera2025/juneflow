// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'project_input.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ProjectInput _$ProjectInputFromJson(Map<String, dynamic> json) => ProjectInput(
  name: json['name'] as String,
  type: ProjectInputType.fromJson(json['type'] as String),
  budget: json['budget'] as num?,
  currencyCode: json['currency_code'] as String?,
);

Map<String, dynamic> _$ProjectInputToJson(ProjectInput instance) =>
    <String, dynamic>{
      'name': instance.name,
      'type': instance.type,
      'budget': instance.budget,
      'currency_code': instance.currencyCode,
    };
