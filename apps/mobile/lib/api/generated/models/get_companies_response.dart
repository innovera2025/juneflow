// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'company.dart';
import 'paginated.dart';

part 'get_companies_response.g.dart';

@JsonSerializable()
class GetCompaniesResponse {
  const GetCompaniesResponse({
    required this.page,
    required this.pageSize,
    required this.total,
    this.data,
  });
  
  factory GetCompaniesResponse.fromJson(Map<String, Object?> json) => _$GetCompaniesResponseFromJson(json);
  
  final List<Company>? data;
  final int page;
  @JsonKey(name: 'page_size')
  final int pageSize;
  final int total;

  Map<String, Object?> toJson() => _$GetCompaniesResponseToJson(this);
}
