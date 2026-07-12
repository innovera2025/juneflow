// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'entity.dart';

part 'auth_login_result.g.dart';

/// POST /auth/login result: token + user + company + package.
@JsonSerializable()
class AuthLoginResult {
  const AuthLoginResult({
    required this.token,
    this.user,
    this.company,
    this.package,
  });
  
  factory AuthLoginResult.fromJson(Map<String, Object?> json) => _$AuthLoginResultFromJson(json);
  
  final String token;
  final Entity? user;
  final Entity? company;
  final Entity? package;

  Map<String, Object?> toJson() => _$AuthLoginResultToJson(this);
}
