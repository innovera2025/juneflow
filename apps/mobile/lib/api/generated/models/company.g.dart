// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'company.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Company _$CompanyFromJson(Map<String, dynamic> json) => Company(
  id: json['id'] as String,
  name: json['name'] as String,
  short: json['short'] as String?,
  color: json['color'] as String?,
  biz: json['biz'] as String?,
  taxId: json['tax_id'] as String?,
  docPrefix: json['doc_prefix'] as String?,
  projectCount: (json['project_count'] as num?)?.toInt(),
);

Map<String, dynamic> _$CompanyToJson(Company instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'short': instance.short,
  'color': instance.color,
  'biz': instance.biz,
  'tax_id': instance.taxId,
  'doc_prefix': instance.docPrefix,
  'project_count': instance.projectCount,
};
