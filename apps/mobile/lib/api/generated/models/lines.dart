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
    this.itemId,
    this.boqItemId,
    this.name,
    this.orderedQty,
    this.unit,
    this.price,
    this.photos,
  });
  
  factory Lines.fromJson(Map<String, Object?> json) => _$LinesFromJson(json);
  
  @JsonKey(name: 'qty_ok')
  final num? qtyOk;
  @JsonKey(name: 'qty_rejected')
  final num? qtyRejected;

  /// B-340: the inventory_item this line receives. Present (with a body-level warehouse_id) → a +qty_ok stock_ledger movement is written; absent → the line is recorded but moves no stock. DISTINCT from boq_item_id, which links the BOQ line and does NOT identify stock — the two catalogues genuinely diverge (BOQ MAT-WIRE-22 vs inventory MAT-WIRE-25, same name, different code), so one is never inferred from the other. Rejected qty is not received into stock; only qty_ok moves.
  @JsonKey(name: 'item_id')
  final String? itemId;

  /// BOQ item this line receives (F1 gr_item per-line)
  @JsonKey(name: 'boq_item_id')
  final String? boqItemId;
  final String? name;
  @JsonKey(name: 'ordered_qty')
  final num? orderedQty;
  final String? unit;
  final num? price;
  final List<String>? photos;

  Map<String, Object?> toJson() => _$LinesToJson(this);
}
