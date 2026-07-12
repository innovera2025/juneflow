// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'file_uploaded.g.dart';

/// Result of POST /files — pass file_id to the owning endpoint.
@JsonSerializable()
class FileUploaded {
  const FileUploaded({
    required this.fileId,
    this.linkModule,
    this.url,
  });
  
  factory FileUploaded.fromJson(Map<String, Object?> json) => _$FileUploadedFromJson(json);
  
  @JsonKey(name: 'file_id')
  final String fileId;
  @JsonKey(name: 'link_module')
  final String? linkModule;
  final String? url;

  Map<String, Object?> toJson() => _$FileUploadedToJson(this);
}
