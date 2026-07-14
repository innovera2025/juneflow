// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'paginated.g.dart';

/// Standard list envelope (B-014). Every list endpoint returns this wrapper: data is the page of rows (item type set per endpoint via allOf), the rest is pagination metadata. Tenant scope still applies.
@JsonSerializable()
class Paginated {
  const Paginated({
    required this.data,
    required this.page,
    required this.pageSize,
    required this.total,
  });
  
  factory Paginated.fromJson(Map<String, Object?> json) => _$PaginatedFromJson(json);
  
  final List<dynamic> data;
  final int page;
  @JsonKey(name: 'page_size')
  final int pageSize;
  final int total;

  Map<String, Object?> toJson() => _$PaginatedToJson(this);
}
