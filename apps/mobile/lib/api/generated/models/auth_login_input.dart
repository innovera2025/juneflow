// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'auth_login_input.g.dart';

@JsonSerializable()
class AuthLoginInput {
  const AuthLoginInput({
    required this.email,
    required this.password,
  });
  
  factory AuthLoginInput.fromJson(Map<String, Object?> json) => _$AuthLoginInputFromJson(json);
  
  final String email;
  final String password;

  Map<String, Object?> toJson() => _$AuthLoginInputToJson(this);
}
