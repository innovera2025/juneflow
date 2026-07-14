// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'company.g.dart';

/// An affiliated group company (บริษัทในเครือ) — B-041(ก+). short/color/ biz/doc_prefix are the Multi-Company switcher fields from company-accept.jsx COMPANIES (Appendix B item 14); project_count is derived from the tenant's project rows attributed to the company.
@JsonSerializable()
class Company {
  const Company({
    required this.id,
    required this.name,
    this.short,
    this.color,
    this.biz,
    this.taxId,
    this.docPrefix,
    this.projectCount,
  });
  
  factory Company.fromJson(Map<String, Object?> json) => _$CompanyFromJson(json);
  
  final String id;
  final String name;
  final String? short;
  final String? color;
  final String? biz;
  @JsonKey(name: 'tax_id')
  final String? taxId;
  @JsonKey(name: 'doc_prefix')
  final String? docPrefix;
  @JsonKey(name: 'project_count')
  final int? projectCount;

  Map<String, Object?> toJson() => _$CompanyToJson(this);
}
