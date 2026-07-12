// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'entity.dart';

part 'me.g.dart';

/// GET /me: user + role + approval_limits + package{menus,limits,ai_used}.
@JsonSerializable()
class Me {
  const Me({
    this.user,
    this.role,
    this.approvalLimits,
    this.package,
  });
  
  factory Me.fromJson(Map<String, Object?> json) => _$MeFromJson(json);
  
  final Entity? user;
  final Entity? role;
  @JsonKey(name: 'approval_limits')
  final Entity? approvalLimits;
  final Entity? package;

  Map<String, Object?> toJson() => _$MeToJson(this);
}
