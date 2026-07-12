// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'items.g.dart';

@JsonSerializable()
class Items {
  const Items({
    this.result,
    this.before,
    this.after,
  });
  
  factory Items.fromJson(Map<String, Object?> json) => _$ItemsFromJson(json);
  
  final String? result;
  final String? before;
  final String? after;

  Map<String, Object?> toJson() => _$ItemsToJson(this);
}
