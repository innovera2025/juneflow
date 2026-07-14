// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'counts.g.dart';

/// GET /counts result — pending-work count per requested nav badge key (B-040(ก)). Keys mirror the request's keys parameter; every value is a tenant-scoped live query count (decision C10 — never hardcoded).
@JsonSerializable()
class Counts {
  const Counts({
    required this.counts,
  });
  
  factory Counts.fromJson(Map<String, Object?> json) => _$CountsFromJson(json);
  
  final Map<String, int> counts;

  Map<String, Object?> toJson() => _$CountsToJson(this);
}
