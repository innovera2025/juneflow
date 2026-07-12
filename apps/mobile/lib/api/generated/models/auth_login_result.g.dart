// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_login_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AuthLoginResult _$AuthLoginResultFromJson(Map<String, dynamic> json) =>
    AuthLoginResult(
      token: json['token'] as String,
      user: json['user'] == null
          ? null
          : Entity.fromJson(json['user'] as Map<String, dynamic>),
      company: json['company'] == null
          ? null
          : Entity.fromJson(json['company'] as Map<String, dynamic>),
      package: json['package'] == null
          ? null
          : Entity.fromJson(json['package'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$AuthLoginResultToJson(AuthLoginResult instance) =>
    <String, dynamic>{
      'token': instance.token,
      'user': instance.user,
      'company': instance.company,
      'package': instance.package,
    };
