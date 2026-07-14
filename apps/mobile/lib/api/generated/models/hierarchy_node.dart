// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'hierarchy_node_kind.dart';

part 'hierarchy_node.g.dart';

/// One node of a project's structure tree (B-053). kind follows the project type's hierarchy labels; unit nodes carry sale/build status.
@JsonSerializable()
class HierarchyNode {
  const HierarchyNode({
    required this.id,
    required this.kind,
    required this.name,
    this.parentId,
    this.code,
    this.modelId,
    this.units,
    this.sold,
    this.built,
    this.color,
    this.status,
  });
  
  factory HierarchyNode.fromJson(Map<String, Object?> json) => _$HierarchyNodeFromJson(json);
  
  final String id;
  @JsonKey(name: 'parent_id')
  final String? parentId;
  final HierarchyNodeKind kind;
  final String? code;
  final String name;
  @JsonKey(name: 'model_id')
  final String? modelId;
  final int? units;
  final int? sold;
  final int? built;
  final String? color;
  final String? status;

  Map<String, Object?> toJson() => _$HierarchyNodeToJson(this);
}
