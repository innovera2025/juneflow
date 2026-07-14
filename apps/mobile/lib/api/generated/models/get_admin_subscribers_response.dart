// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'entity.dart';
import 'paginated.dart';

part 'get_admin_subscribers_response.g.dart';

@JsonSerializable()
class GetAdminSubscribersResponse {
  const GetAdminSubscribersResponse({
    required this.page,
    required this.pageSize,
    required this.total,
    this.data,
  });
  
  factory GetAdminSubscribersResponse.fromJson(Map<String, Object?> json) => _$GetAdminSubscribersResponseFromJson(json);
  
  final List<Entity>? data;
  final int page;
  @JsonKey(name: 'page_size')
  final int pageSize;
  final int total;

  Map<String, Object?> toJson() => _$GetAdminSubscribersResponseToJson(this);
}
