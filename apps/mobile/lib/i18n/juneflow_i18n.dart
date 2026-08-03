// Key-based i18n runtime for juneflow_mobile (MOB-I18N-01).
//
// RULE (PLAN.md §0 rule 2): every translation comes ONLY from the sacred
// docs/extract/i18n-full.json, bundled verbatim as assets/i18n/i18n-full.json by
// tool/gen_i18n_asset.sh. Never translate, re-word or invent a single string here.
// A user-visible string with no entry in that file => BLOCKERS.md, then skip.
//
// RULE (PLAN.md §0 rule 3): the prototype translates via a DOM MutationObserver.
// That is a mock mechanism and must NOT be ported — production is key-based only.
//
// Semantics are a 1:1 port of packages/i18n/src/index.ts (the web/TS loader), so
// the two platforms cannot drift. The three layers come from
// docs/extract/I18N-KEYS.md §2:
//
//   dict     : stable key           -> { th, en, zh, ar }   -> t()
//   nav_i18n : the Thai label IS the key -> { en, zh, ar, … } -> tn()
//   phrases  : the Thai phrase IS the key -> { en, zh, ar }   -> tp()
//
// plus phrase_patterns (regex + per-language template) for number-bearing
// sentences, which Wei ruled in BLOCKERS.md B-017 (ก) must live in the JSON —
// consumers read them from the file and never hardcode a Thai literal. tpat()
// is that reader.
//
// Because the Thai text IS the key for the nav_i18n/phrases layers, screens must
// never write those keys as Dart literals: .claude/hooks/i18n-guard.sh blocks any
// Thai character in lib/**.dart (exit 2). Keys live in per-screen JSON sidecars
// instead — see screen_strings.dart (same pattern as apps/web *-strings.json).
import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

/// Asset path of the verbatim copy of the sacred translation source.
const String kI18nAssetPath = 'assets/i18n/i18n-full.json';

/// Default language of the prototype (Thai). Tenant/user setting overrides it.
const String kDefaultLang = 'th';

/// Language metadata as declared by `langs` in i18n-full.json.
///
/// [dir] drives layout direction ("rtl" for Arabic) — it is read from the file,
/// never hardcoded per screen.
class LangDef {
  const LangDef({
    required this.code,
    required this.label,
    required this.en,
    required this.dir,
  });

  factory LangDef.fromJson(Map<String, dynamic> json) {
    return LangDef(
      code: json['code'] as String? ?? '',
      label: json['label'] as String? ?? '',
      en: json['en'] as String? ?? '',
      dir: json['dir'] as String? ?? 'ltr',
    );
  }

  final String code;

  /// Endonym shown in the language switcher (from the source file, not translated).
  final String label;

  /// English name of the language (from the source file).
  final String en;

  /// "ltr" or "rtl".
  final String dir;
}

/// One entry of the `phrase_patterns` block (BLOCKERS.md B-017 ruling ก).
///
/// [source] is the raw regex string as written in the file; [templates] maps a
/// language code to its template, where `$1`, `$2`, … are the capture groups.
class PhrasePattern {
  PhrasePattern({required this.source, required this.flags, required this.templates})
    : regExp = RegExp(
        source,
        caseSensitive: !flags.contains('i'),
        multiLine: flags.contains('m'),
        dotAll: flags.contains('s'),
      );

  factory PhrasePattern.fromJson(Map<String, dynamic> json) {
    final Map<String, String> templates = <String, String>{};
    for (final MapEntry<String, dynamic> e in json.entries) {
      if (e.key == 're' || e.key == 'flags') continue;
      final dynamic value = e.value;
      if (value is String) templates[e.key] = value;
    }
    return PhrasePattern(
      source: json['re'] as String? ?? '',
      flags: json['flags'] as String? ?? '',
      templates: templates,
    );
  }

  final String source;
  final String flags;
  final Map<String, String> templates;
  final RegExp regExp;

  /// Substitutes `$1..$n` in [template] with the captured groups of [match].
  ///
  /// Done by hand rather than via [String.replaceAll] so a captured value that
  /// itself contains `$1` can never be re-expanded.
  static String applyTemplate(String template, RegExpMatch match) {
    final StringBuffer out = StringBuffer();
    for (int i = 0; i < template.length; i++) {
      final String ch = template[i];
      if (ch != r'$' || i + 1 >= template.length) {
        out.write(ch);
        continue;
      }
      int j = i + 1;
      while (j < template.length && _isDigit(template[j])) {
        j++;
      }
      if (j == i + 1) {
        out.write(ch); // a lone '$' is literal
        continue;
      }
      final int group = int.parse(template.substring(i + 1, j));
      if (group >= 1 && group <= match.groupCount) {
        out.write(match.group(group) ?? '');
      }
      i = j - 1;
    }
    return out.toString();
  }

  static bool _isDigit(String ch) {
    final int c = ch.codeUnitAt(0);
    return c >= 0x30 && c <= 0x39;
  }
}

/// Key-based translator over the sacred i18n source.
///
/// Load once at startup ([load]) and keep a single instance; every lookup is a
/// synchronous map read afterwards.
class JuneflowI18n {
  JuneflowI18n._({
    required List<LangDef> langs,
    required Map<String, Map<String, dynamic>> dict,
    required Map<String, Map<String, dynamic>> nav,
    required Map<String, Map<String, dynamic>> phrases,
    required List<PhrasePattern> patterns,
    required String lang,
  }) : _langs = langs,
       _dict = dict,
       _nav = nav,
       _phrases = phrases,
       _patterns = patterns,
       _lang = lang;

  /// Parses the verbatim source. Prefer [load]; this exists for tests and for
  /// callers that already hold the file contents.
  factory JuneflowI18n.fromJsonString(String source, {String lang = kDefaultLang}) {
    final Map<String, dynamic> root = jsonDecode(source) as Map<String, dynamic>;
    return JuneflowI18n._(
      langs: <LangDef>[
        for (final dynamic l in (root['langs'] as List<dynamic>? ?? <dynamic>[]))
          if (l is Map<String, dynamic>) LangDef.fromJson(l),
      ],
      dict: _entryMap(root['dict']),
      nav: _entryMap(root['nav_i18n']),
      phrases: _entryMap(root['phrases']),
      patterns: <PhrasePattern>[
        for (final dynamic p in (root['phrase_patterns'] as List<dynamic>? ?? <dynamic>[]))
          if (p is Map<String, dynamic>) PhrasePattern.fromJson(p),
      ],
      lang: lang,
    );
  }

  /// Reads [kI18nAssetPath] from the app bundle and parses it.
  static Future<JuneflowI18n> load({
    AssetBundle? bundle,
    String lang = kDefaultLang,
  }) async {
    final String source = await (bundle ?? rootBundle).loadString(kI18nAssetPath);
    return JuneflowI18n.fromJsonString(source, lang: lang);
  }

  static Map<String, Map<String, dynamic>> _entryMap(dynamic raw) {
    final Map<String, Map<String, dynamic>> out = <String, Map<String, dynamic>>{};
    if (raw is Map<String, dynamic>) {
      for (final MapEntry<String, dynamic> e in raw.entries) {
        final dynamic v = e.value;
        if (v is Map<String, dynamic>) out[e.key] = v;
      }
    }
    return out;
  }

  final List<LangDef> _langs;
  final Map<String, Map<String, dynamic>> _dict;
  final Map<String, Map<String, dynamic>> _nav;
  final Map<String, Map<String, dynamic>> _phrases;
  final List<PhrasePattern> _patterns;
  String _lang;

  /// Language metadata from the source file — drives the language switcher UI.
  List<LangDef> get langs => List<LangDef>.unmodifiable(_langs);

  /// Active language code.
  String get lang => _lang;

  set lang(String value) => _lang = normalizeLang(value);

  /// Number of loaded entries per layer — used by tests and the loader gate.
  int get dictCount => _dict.length;
  int get navCount => _nav.length;
  int get phraseCount => _phrases.length;
  int get patternCount => _patterns.length;

  /// Canonicalises a requested code so it can be matched against the file:
  /// language subtag lowercased, region subtag uppercased ("zh-tw" -> "zh-TW").
  ///
  /// It deliberately does NOT collapse the region away — 19 nav_i18n keys carry
  /// their own "zh-TW" entry (I18N-KEYS.md §2), and that entry must win over the
  /// generic "zh" one. Collapsing happens later, in [fallbackChain].
  static String normalizeLang(String code) {
    final String trimmed = code.trim();
    if (trimmed.isEmpty) return kDefaultLang;
    final int dash = trimmed.indexOf('-');
    if (dash <= 0) return trimmed.toLowerCase();
    final String base = trimmed.substring(0, dash).toLowerCase();
    final String region = trimmed.substring(dash + 1).toUpperCase();
    return region.isEmpty ? base : '$base-$region';
  }

  /// Lookup order for [code], per I18N-KEYS.md §1 langResolve:
  /// a language with no translation falls back to `en` then `th`, and a regional
  /// variant tries its base language first ("zh-TW" -> "zh" -> "en" -> "th").
  static List<String> fallbackChain(String code) {
    final String normalized = normalizeLang(code);
    final int dash = normalized.indexOf('-');
    return <String>[
      normalized,
      if (dash > 0) normalized.substring(0, dash),
      'en',
      'th',
    ];
  }

  /// True when the active (or given) language lays out right-to-left.
  ///
  /// The flag comes from `langs[].dir` in the source file — never hardcoded. A
  /// regional variant inherits the direction of its base language; a code absent
  /// from `langs` is treated as ltr, matching the web loader.
  bool isRTL([String? code]) {
    for (final String candidate in fallbackChain(code ?? _lang)) {
      for (final LangDef l in _langs) {
        if (normalizeLang(l.code) == candidate) return l.dir == 'rtl';
      }
      if (candidate == 'en') break; // stop before the en/th backstops
    }
    return false;
  }

  /// Layout direction for the active (or given) language.
  String dir([String? code]) => isRTL(code) ? 'rtl' : 'ltr';

  /// Fallback resolution per I18N-KEYS.md §1: requested -> (base) -> en -> th.
  String? _resolveEntry(Map<String, dynamic> entry, String code) {
    for (final String candidate in fallbackChain(code)) {
      final dynamic value = entry[candidate];
      if (value is String) return value;
    }
    return null;
  }

  /// Layer 1 — DICT: a stable key maps to { th, en, zh, ar }.
  ///
  /// A missing key is a programming error: the string belongs in BLOCKERS.md,
  /// never invented here. The key itself is returned as a visible marker.
  String t(String key, [String? code]) {
    final Map<String, dynamic>? entry = _dict[key];
    if (entry == null) return key;
    return _resolveEntry(entry, code ?? _lang) ?? key;
  }

  /// Layer 2 — NAV: the Thai menu label IS the key. For "th" the key is the text.
  String tn(String key, [String? code]) {
    final String target = code ?? _lang;
    if (_isThai(target)) return key;
    final Map<String, dynamic>? entry = _nav[key];
    if (entry == null) return key;
    return _resolveEntry(entry, target) ?? key;
  }

  /// Layer 3 — PHRASES: the Thai phrase IS the key. For "th" the key is the text.
  String tp(String key, [String? code]) {
    final String target = code ?? _lang;
    if (_isThai(target)) return key;
    final Map<String, dynamic>? entry = _phrases[key];
    if (entry == null) return key;
    return _resolveEntry(entry, target) ?? key;
  }

  /// Whether [code] is Thai (including any regional variant): for the two layers
  /// whose key IS the Thai text, that means the key is already the translation.
  static bool _isThai(String code) => fallbackChain(code).first.split('-').first == 'th';

  /// PHRASE_PATTERNS — number-bearing sentences (BLOCKERS.md B-017 ruling ก).
  ///
  /// [source] is the rendered Thai sentence (built from a screen's JSON sidecar
  /// plus runtime values). The first pattern whose regex matches wins; its
  /// per-language template is filled with the captured groups. With no matching
  /// pattern the input is returned unchanged, so a sentence whose pattern Wei has
  /// not yet added to the file stays readable instead of silently blanking — and
  /// [hasPatternFor] lets a caller assert the gap instead of shipping it.
  String tpat(String source, [String? code]) {
    for (final PhrasePattern p in _patterns) {
      final RegExpMatch? match = p.regExp.firstMatch(source);
      if (match == null) continue;
      for (final String candidate in fallbackChain(code ?? _lang)) {
        final String? template = p.templates[candidate];
        if (template != null) return PhrasePattern.applyTemplate(template, match);
      }
      return source;
    }
    return source;
  }

  /// Whether any loaded pattern matches [source] — lets a screen fail loudly on a
  /// sentence that still needs a Wei-approved pattern instead of shipping the raw
  /// Thai (PLAN.md §0 rule 2).
  bool hasPatternFor(String source) =>
      _patterns.any((PhrasePattern p) => p.regExp.hasMatch(source));
}
