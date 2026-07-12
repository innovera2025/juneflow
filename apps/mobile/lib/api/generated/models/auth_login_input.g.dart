// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_login_input.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AuthLoginInput _$AuthLoginInputFromJson(Map<String, dynamic> json) =>
    AuthLoginInput(
      email: json['email'] as String,
      password: json['password'] as String,
    );

Map<String, dynamic> _$AuthLoginInputToJson(AuthLoginInput instance) =>
    <String, dynamic>{'email': instance.email, 'password': instance.password};
