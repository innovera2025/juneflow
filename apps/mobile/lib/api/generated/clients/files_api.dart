// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/file_uploaded.dart';

part 'files_api.g.dart';

@RestApi()
abstract class FilesApi {
  factory FilesApi(Dio dio, {String? baseUrl}) = _FilesApi;

  /// Upload file (multipart) → file_id — enters DMS with link_module.
  ///
  /// api-contract.md note 2: attachments upload here first, then pass the returned file_id to the owning endpoint. Storage quota enforced.
  @MultiPart()
  @POST('/files')
  Future<FileUploaded> uploadFile({
    @Part(name: 'file') required File file,
    @Part(name: 'link_module') String? linkModule,
  });
}
