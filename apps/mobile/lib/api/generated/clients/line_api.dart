// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';
import 'package:retrofit/retrofit.dart';

import '../models/entity.dart';

part 'line_api.g.dart';

@RestApi()
abstract class LineApi {
  factory LineApi(Dio dio, {String? baseUrl}) = _LineApi;

  /// LINE OA webhook (inbound events).
  ///
  /// Inbound webhook from LINE. Unlike every other endpoint it does NOT carry our Bearer JWT — LINE signs the request with x-line-signature, which the platform verifies. Hence security is overridden to none here.
  @POST('/line/webhook')
  Future<void> lineWebhook({
    @Body() required Entity body,
  });
}
