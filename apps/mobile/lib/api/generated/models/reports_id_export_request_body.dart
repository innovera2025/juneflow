// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'reports_id_export_request_body.g.dart';

@JsonSerializable()
class ReportsIdExportRequestBody {
  const ReportsIdExportRequestBody({
    this.format,
  });
  
  factory ReportsIdExportRequestBody.fromJson(Map<String, Object?> json) => _$ReportsIdExportRequestBodyFromJson(json);
  
  final String? format;

  Map<String, Object?> toJson() => _$ReportsIdExportRequestBodyToJson(this);
}
