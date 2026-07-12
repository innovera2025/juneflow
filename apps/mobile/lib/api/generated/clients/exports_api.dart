// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/exports_request_body.dart';
import '../models/job.dart';

part 'exports_api.g.dart';

@RestApi()
abstract class ExportsApi {
  factory ExportsApi(Dio dio, {String? baseUrl}) = _ExportsApi;

  /// Start async export ({type,params})
  @POST('/exports')
  Future<Job> createExport({
    @Body() required ExportsRequestBody body,
  });

  /// Get export job (url when done)
  @GET('/exports/{id}')
  Future<Job> getExport({
    @Path('id') required String id,
  });
}
