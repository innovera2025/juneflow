// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'lines.dart';

part 'gr_request_body.g.dart';

@JsonSerializable()
class GrRequestBody {
  const GrRequestBody({
    required this.lines,
    this.poId,
    this.woId,
    this.idempotencyKey,
    this.warehouseId,
  });
  
  factory GrRequestBody.fromJson(Map<String, Object?> json) => _$GrRequestBodyFromJson(json);
  
  @JsonKey(name: 'po_id')
  final String? poId;

  /// Alternative to po_id — GR against a work order (B-070 GR-from-WO)
  @JsonKey(name: 'wo_id')
  final String? woId;

  /// Client-generated idempotency key (B-261). A create whose key was already seen returns the ORIGINAL receipt (2xx, no duplicate row) — makes the mobile offline-queue at-least-once replay safe. Omit → no dedup.
  @JsonKey(name: 'idempotency_key')
  final String? idempotencyKey;

  /// B-340: destination warehouse for the received goods. REQUIRED when any line carries item_id — that pair is what writes the +qty stock_ledger movement (ref_doc `gr:<id>`). A receipt with neither is recorded exactly as before and moves no stock. Must resolve inside this tenant, else 400.
  @JsonKey(name: 'warehouse_id')
  final String? warehouseId;
  final List<Lines> lines;

  Map<String, Object?> toJson() => _$GrRequestBodyToJson(this);
}
