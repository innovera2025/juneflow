// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'project.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Project _$ProjectFromJson(Map<String, dynamic> json) => Project(
  id: json['id'] as String,
  name: json['name'] as String,
  type: ProjectType.fromJson(json['type'] as String),
  status: json['status'] as String,
  budget: json['budget'] as num?,
  currencyCode: json['currency_code'] as String?,
);

Map<String, dynamic> _$ProjectToJson(Project instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'type': instance.type,
  'budget': instance.budget,
  'currency_code': instance.currencyCode,
  'status': instance.status,
};
