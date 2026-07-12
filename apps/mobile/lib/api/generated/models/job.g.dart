// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'job.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Job _$JobFromJson(Map<String, dynamic> json) => Job(
  jobId: json['job_id'] as String?,
  id: json['id'] as String?,
  status: json['status'] as String?,
  url: json['url'] as String?,
);

Map<String, dynamic> _$JobToJson(Job instance) => <String, dynamic>{
  'job_id': instance.jobId,
  'id': instance.id,
  'status': instance.status,
  'url': instance.url,
};
