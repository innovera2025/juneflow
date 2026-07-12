// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'job.g.dart';

/// Async job handle (AI QTO / exports). url present when done.
@JsonSerializable()
class Job {
  const Job({
    this.jobId,
    this.id,
    this.status,
    this.url,
  });
  
  factory Job.fromJson(Map<String, Object?> json) => _$JobFromJson(json);
  
  @JsonKey(name: 'job_id')
  final String? jobId;
  final String? id;
  final String? status;
  final String? url;

  Map<String, Object?> toJson() => _$JobToJson(this);
}
