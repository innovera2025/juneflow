// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pm_workorders_id_checklist_request_body.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PmWorkordersIdChecklistRequestBody _$PmWorkordersIdChecklistRequestBodyFromJson(
  Map<String, dynamic> json,
) => PmWorkordersIdChecklistRequestBody(
  items: (json['items'] as List<dynamic>?)
      ?.map((e) => Items.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$PmWorkordersIdChecklistRequestBodyToJson(
  PmWorkordersIdChecklistRequestBody instance,
) => <String, dynamic>{'items': instance.items};
