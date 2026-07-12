// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Me _$MeFromJson(Map<String, dynamic> json) => Me(
  user: json['user'] == null
      ? null
      : Entity.fromJson(json['user'] as Map<String, dynamic>),
  role: json['role'] == null
      ? null
      : Entity.fromJson(json['role'] as Map<String, dynamic>),
  approvalLimits: json['approval_limits'] == null
      ? null
      : Entity.fromJson(json['approval_limits'] as Map<String, dynamic>),
  package: json['package'] == null
      ? null
      : Entity.fromJson(json['package'] as Map<String, dynamic>),
);

Map<String, dynamic> _$MeToJson(Me instance) => <String, dynamic>{
  'user': instance.user,
  'role': instance.role,
  'approval_limits': instance.approvalLimits,
  'package': instance.package,
};
