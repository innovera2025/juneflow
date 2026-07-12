// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'gl_post_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GlPostRequestBody _$GlPostRequestBodyFromJson(Map<String, dynamic> json) =>
    GlPostRequestBody(
      docIds: (json['doc_ids'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$GlPostRequestBodyToJson(GlPostRequestBody instance) =>
    <String, dynamic>{'doc_ids': instance.docIds};
