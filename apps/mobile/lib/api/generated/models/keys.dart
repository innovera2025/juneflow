// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum Keys {
  @JsonValue('boq')
  boq('boq'),
  /// Incorrect name has been replaced. Original name: `boq.approval`.
  @JsonValue('boq.approval')
  undefined0('boq.approval'),
  /// Incorrect name has been replaced. Original name: `pr.list`.
  @JsonValue('pr.list')
  undefined1('pr.list'),
  @JsonValue('accept')
  accept('accept'),
  /// Incorrect name has been replaced. Original name: `pm.wo`.
  @JsonValue('pm.wo')
  undefined2('pm.wo'),
  /// Incorrect name has been replaced. Original name: `gl.inbox`.
  @JsonValue('gl.inbox')
  undefined3('gl.inbox'),
  @JsonValue('sales')
  sales('sales'),
  /// Incorrect name has been replaced. Original name: `sales.crm`.
  @JsonValue('sales.crm')
  undefined4('sales.crm'),
  /// Incorrect name has been replaced. Original name: `sales.service`.
  @JsonValue('sales.service')
  undefined5('sales.service'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const Keys(this.json);

  factory Keys.fromJson(String json) => values.firstWhere(
        (e) => e.json == json,
        orElse: () => $unknown,
      );

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError('Cannot convert enum value with null JSON representation to String. '
          'This usually happens for \$unknown or @JsonValue(null) entries.');
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
  /// Returns all defined enum values excluding the $unknown value.
  static List<Keys> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
