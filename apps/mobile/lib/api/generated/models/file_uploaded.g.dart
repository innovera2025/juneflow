// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'file_uploaded.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FileUploaded _$FileUploadedFromJson(Map<String, dynamic> json) => FileUploaded(
  fileId: json['file_id'] as String,
  linkModule: json['link_module'] as String?,
  url: json['url'] as String?,
);

Map<String, dynamic> _$FileUploadedToJson(FileUploaded instance) =>
    <String, dynamic>{
      'file_id': instance.fileId,
      'link_module': instance.linkModule,
      'url': instance.url,
    };
