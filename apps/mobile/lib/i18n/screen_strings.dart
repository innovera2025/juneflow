// Per-screen key sidecars (MOB-I18N-01).
//
// The nav_i18n and phrases layers use the Thai text ITSELF as the lookup key
// (docs/extract/I18N-KEYS.md §2). Writing those keys as Dart literals is
// impossible here: .claude/hooks/i18n-guard.sh blocks every Thai character in
// lib/**.dart with exit 2, and it is right to — a Thai literal in source is
// exactly the hardcoding PLAN.md §0 rule 2 forbids.
//
// apps/web solved this with `*-strings.json` sidecars (see
// apps/web/src/screens/land/land-survey-strings.json): the guard skips .json, so
// the keys sit there and the screen imports them. This is the Flutter equivalent —
// one `assets/i18n/screens/<screen>_strings.json` per screen, loaded at runtime
// and fed straight into JuneflowI18n.tp()/tn().
//
// A sidecar carries KEYS ONLY — never a translation. Every key must already exist
// in the sacred docs/extract/i18n-full.json; a string with no key there goes to
// BLOCKERS.md and the screen waits (PLAN.md §0 rule 2, rule 4).
import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

/// Directory holding the per-screen key sidecars.
const String kScreenStringsDir = 'assets/i18n/screens';

/// The keys one screen needs, read from its JSON sidecar.
class ScreenStrings {
  const ScreenStrings._(this.assetPath, this._values);

  /// Parses sidecar [source]. Prefer [load]; this exists for tests.
  ///
  /// Keys starting with `_` are documentation fields (`_source` records where the
  /// strings came from, as the web sidecars do) and are not lookups.
  factory ScreenStrings.fromJsonString(String source, {String assetPath = '<inline>'}) {
    final Map<String, dynamic> raw;
    try {
      raw = jsonDecode(source) as Map<String, dynamic>;
    } on Object catch (e) {
      // Name the file: without this the failure is a bare FormatException and the
      // author has no idea which of the 26 screens' sidecars is malformed.
      throw FormatException('i18n sidecar $assetPath is not a JSON object: $e');
    }
    final Map<String, String> values = <String, String>{};
    for (final MapEntry<String, dynamic> e in raw.entries) {
      if (e.key.startsWith('_')) continue;
      final dynamic v = e.value;
      if (v is String) values[e.key] = v;
    }
    return ScreenStrings._(assetPath, values);
  }

  /// Loads the sidecar of [screen] from `assets/i18n/screens/<screen>_strings.json`.
  static Future<ScreenStrings> load(String screen, {AssetBundle? bundle}) async {
    final String path = '$kScreenStringsDir/${screen}_strings.json';
    final String source = await (bundle ?? rootBundle).loadString(path);
    return ScreenStrings.fromJsonString(source, assetPath: path);
  }

  /// Asset this sidecar was read from — used in error messages.
  final String assetPath;
  final Map<String, String> _values;

  /// Field names available in this sidecar.
  Iterable<String> get names => _values.keys;

  /// The key registered under [name].
  ///
  /// Throws when [name] is absent: a screen asking for a string that has no entry
  /// is the case PLAN.md §0 rule 2 sends to BLOCKERS.md, so it must fail loudly at
  /// development time rather than render a blank or an invented word.
  String operator [](String name) {
    final String? value = _values[name];
    if (value == null) {
      throw StateError(
        'i18n sidecar $assetPath has no entry "$name". '
        'Add the key (it must already exist in docs/extract/i18n-full.json) '
        'or raise it in BLOCKERS.md — never translate it inline.',
      );
    }
    return value;
  }

  /// The key under [name], or null when absent — for optional slots where the
  /// caller has its own honest-empty branch.
  String? maybe(String name) => _values[name];
}
