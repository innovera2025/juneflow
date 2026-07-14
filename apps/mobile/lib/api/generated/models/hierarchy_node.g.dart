// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'hierarchy_node.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

HierarchyNode _$HierarchyNodeFromJson(Map<String, dynamic> json) =>
    HierarchyNode(
      id: json['id'] as String,
      kind: HierarchyNodeKind.fromJson(json['kind'] as String),
      name: json['name'] as String,
      parentId: json['parent_id'] as String?,
      code: json['code'] as String?,
      modelId: json['model_id'] as String?,
      units: (json['units'] as num?)?.toInt(),
      sold: (json['sold'] as num?)?.toInt(),
      built: (json['built'] as num?)?.toInt(),
      color: json['color'] as String?,
      status: json['status'] as String?,
    );

Map<String, dynamic> _$HierarchyNodeToJson(HierarchyNode instance) =>
    <String, dynamic>{
      'id': instance.id,
      'parent_id': instance.parentId,
      'kind': instance.kind,
      'code': instance.code,
      'name': instance.name,
      'model_id': instance.modelId,
      'units': instance.units,
      'sold': instance.sold,
      'built': instance.built,
      'color': instance.color,
      'status': instance.status,
    };
