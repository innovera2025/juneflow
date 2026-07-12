// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'lines.g.dart';

@JsonSerializable()
class Lines {
  const Lines({
    this.qtyOk,
    this.qtyRejected,
    this.photos,
  });
  
  factory Lines.fromJson(Map<String, Object?> json) => _$LinesFromJson(json);
  
  @JsonKey(name: 'qty_ok')
  final num? qtyOk;
  @JsonKey(name: 'qty_rejected')
  final num? qtyRejected;
  final List<String>? photos;

  Map<String, Object?> toJson() => _$LinesToJson(this);
}
