// Tests for the mobile i18n runtime (MOB-I18N-01).
//
// Thai literals are legitimate HERE and only here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and the nav_i18n/phrases layers use the Thai text
// itself as the lookup key, so a test cannot assert them without naming them.
// Every Thai string below is copied byte-for-byte out of the sacred
// docs/extract/i18n-full.json — nothing is translated or invented.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Minimal stand-in for the sacred file, shaped exactly like it (3 layers +
/// phrase_patterns + langs) so the pure parsing/fallback logic is testable
/// without the 1.2 MB asset.
const String _fixture = '''
{
  "langs": [
    {"code": "th", "label": "ไทย", "en": "Thai", "dir": "ltr"},
    {"code": "zh", "label": "简体中文", "en": "Chinese", "dir": "ltr"},
    {"code": "en", "label": "English", "en": "English", "dir": "ltr"},
    {"code": "ar", "label": "العربية (دبي)", "en": "Arabic (UAE)", "dir": "rtl"}
  ],
  "dict": {
    "common.cancel": {"th": "ยกเลิก", "en": "Cancel", "zh": "取消", "ar": "إلغاء"},
    "only.en": {"en": "OnlyEnglish"},
    "only.th": {"th": "เฉพาะไทย"}
  },
  "nav_i18n": {
    "งานหลัก": {"en": "Main", "zh": "主要", "ar": "الرئيسية", "zh-TW": "主要TW"}
  },
  "phrases": {
    "ทั้งหมด": {"en": "All", "zh": "全部", "ar": "الكل"}
  },
  "phrase_patterns": [
    {"re": "^แสดง (.+) จาก (.+) รายการ\$", "flags": "",
     "th": "แสดง \$1 จาก \$2 รายการ", "en": "Showing \$1 of \$2",
     "zh": "显示 \$1 / 共 \$2", "ar": "عرض \$1 من \$2"},
    {"re": "^กรอง · (\\\\d+)\$", "flags": "",
     "th": "กรอง · \$1", "en": "Filter · \$1", "zh": "筛选 · \$1", "ar": "تصفية · \$1"}
  ]
}
''';

void main() {
  final JuneflowI18n i18n = JuneflowI18n.fromJsonString(_fixture);

  group('parsing', () {
    test('loads every layer declared by I18N-KEYS.md §2', () {
      expect(i18n.dictCount, 3);
      expect(i18n.navCount, 1);
      expect(i18n.phraseCount, 1);
      expect(i18n.patternCount, 2);
      expect(i18n.langs.length, 4);
    });

    test('language metadata comes from the file, not from code', () {
      final LangDef ar = i18n.langs.firstWhere((LangDef l) => l.code == 'ar');
      expect(ar.dir, 'rtl');
      expect(ar.en, 'Arabic (UAE)');
    });

    test('defaults to Thai', () => expect(i18n.lang, 'th'));
  });

  group('t() — DICT layer', () {
    test('resolves the requested language', () {
      expect(i18n.t('common.cancel', 'en'), 'Cancel');
      expect(i18n.t('common.cancel', 'zh'), '取消');
      expect(i18n.t('common.cancel', 'ar'), 'إلغاء');
      expect(i18n.t('common.cancel', 'th'), 'ยกเลิก');
    });

    test('falls back requested -> en -> th', () {
      expect(i18n.t('only.en', 'zh'), 'OnlyEnglish'); // no zh -> en
      expect(i18n.t('only.th', 'zh'), 'เฉพาะไทย'); // no zh, no en -> th
    });

    test('returns the key itself when the key is absent', () {
      // A missing key is a BLOCKERS.md case, never an invented translation.
      expect(i18n.t('no.such.key', 'en'), 'no.such.key');
    });

    test('uses the active language when none is passed', () {
      final JuneflowI18n scoped = JuneflowI18n.fromJsonString(_fixture)..lang = 'en';
      expect(scoped.t('common.cancel'), 'Cancel');
    });
  });

  group('tf() / format() — {placeholder} interpolation', () {
    // 421 dict entries in the sacred file carry {name} placeholders; this is the
    // repo's mechanism for runtime values, and apps/web does the same swap inline.
    test('substitutes every declared placeholder', () {
      expect(
        JuneflowI18n.format('ใช้ไป {pct}% · เหลือ {left}', <String, Object?>{'pct': 94.6, 'left': '257K'}),
        'ใช้ไป 94.6% · เหลือ 257K',
      );
    });

    test('repeats a placeholder used more than once', () {
      expect(JuneflowI18n.format('{n}/{n}', <String, Object?>{'n': 5}), '5/5');
    });

    test('leaves an unsupplied placeholder visible rather than blank', () {
      expect(JuneflowI18n.format('ใช้ไป {pct}%', <String, Object?>{}), 'ใช้ไป {pct}%');
      expect(
        JuneflowI18n.format('{a} {b}', <String, Object?>{'a': 'x'}),
        'x {b}',
      );
    });

    test('substitutes an explicit null as the word null, not as a gap', () {
      // containsKey, not a null check: passing null is a caller bug worth seeing.
      expect(JuneflowI18n.format('{a}', <String, Object?>{'a': null}), 'null');
    });

    test('ignores braces that are not placeholders', () {
      expect(JuneflowI18n.format('{ }{1x}{}', <String, Object?>{'a': 1}), '{ }{1x}{}');
    });

    test('a substituted value containing a placeholder is not re-expanded', () {
      expect(
        JuneflowI18n.format('{a}', <String, Object?>{'a': '{a}', 'b': 'boom'}),
        '{a}',
      );
    });

    test('tf() resolves through the dict layer first', () {
      final JuneflowI18n withPlaceholder = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code": "en", "label": "English", "en": "English", "dir": "ltr"}],
  "dict": {"pct": {"th": "ใช้ไป {pct}%", "en": "used {pct}%"}},
  "nav_i18n": {}, "phrases": {}, "phrase_patterns": []
}
''');
      expect(withPlaceholder.tf('pct', <String, Object?>{'pct': 94.6}, 'en'), 'used 94.6%');
      expect(withPlaceholder.tf('pct', <String, Object?>{'pct': 94.6}, 'th'), 'ใช้ไป 94.6%');
      // Unknown key still degrades to the key itself, placeholders and all.
      expect(withPlaceholder.tf('missing', <String, Object?>{'pct': 1}, 'en'), 'missing');
    });
  });

  group('tn() — NAV layer (Thai label is the key)', () {
    test('returns the key unchanged for Thai', () => expect(i18n.tn('งานหลัก', 'th'), 'งานหลัก'));

    test('translates for other languages', () {
      expect(i18n.tn('งานหลัก', 'en'), 'Main');
      expect(i18n.tn('งานหลัก', 'ar'), 'الرئيسية');
    });

    test('an explicit regional entry beats its base language', () {
      // I18N-KEYS.md §2: 19 nav keys carry their own zh-TW entry — it must win.
      expect(i18n.tn('งานหลัก', 'zh-TW'), '主要TW');
      expect(i18n.tn('งานหลัก', 'zh'), '主要');
    });

    test('a regional variant with no entry falls back to its base', () {
      expect(i18n.tn('งานหลัก', 'zh-HK'), '主要');
    });

    test('an unlisted language falls back to English', () {
      // I18N-KEYS.md §1 records bn/fa/id/ja/pt as falling back to English.
      expect(i18n.tn('งานหลัก', 'ja'), 'Main');
    });

    test('returns the key itself when absent', () => expect(i18n.tn('ไม่มีคีย์นี้', 'en'), 'ไม่มีคีย์นี้'));
  });

  group('tp() — PHRASES layer (Thai phrase is the key)', () {
    test('returns the key unchanged for Thai', () => expect(i18n.tp('ทั้งหมด', 'th'), 'ทั้งหมด'));

    test('translates for other languages', () {
      expect(i18n.tp('ทั้งหมด', 'en'), 'All');
      expect(i18n.tp('ทั้งหมด', 'zh'), '全部');
      expect(i18n.tp('ทั้งหมด', 'ar'), 'الكل');
    });

    test('returns the key itself when absent', () => expect(i18n.tp('ยังไม่มีคีย์', 'en'), 'ยังไม่มีคีย์'));
  });

  group('language handling', () {
    test('normalizeLang canonicalises without collapsing the region', () {
      expect(JuneflowI18n.normalizeLang('TH'), 'th');
      expect(JuneflowI18n.normalizeLang('zh-tw'), 'zh-TW');
      expect(JuneflowI18n.normalizeLang('  en  '), 'en');
      expect(JuneflowI18n.normalizeLang(''), 'th');
    });

    test('fallbackChain matches I18N-KEYS.md §1 langResolve', () {
      expect(JuneflowI18n.fallbackChain('zh-TW'), <String>['zh-TW', 'zh', 'en', 'th']);
      expect(JuneflowI18n.fallbackChain('ar'), <String>['ar', 'en', 'th']);
    });

    test('isRTL/dir read the flag from langs[], and only ar is rtl', () {
      expect(i18n.isRTL('ar'), isTrue);
      expect(i18n.dir('ar'), 'rtl');
      for (final String code in <String>['th', 'en', 'zh']) {
        expect(i18n.isRTL(code), isFalse, reason: code);
        expect(i18n.dir(code), 'ltr', reason: code);
      }
    });

    test('a regional variant inherits its base direction', () => expect(i18n.dir('zh-TW'), 'ltr'));

    test('an unlisted language is ltr rather than inheriting the en/th backstop', () {
      expect(i18n.isRTL('ja'), isFalse);
    });

    test('setting lang canonicalises it', () {
      final JuneflowI18n scoped = JuneflowI18n.fromJsonString(_fixture)..lang = 'zh-tw';
      expect(scoped.lang, 'zh-TW');
    });
  });

  group('tpat() — PHRASE_PATTERNS (BLOCKERS.md B-017 ruling (a))', () {
    test('substitutes captures into the per-language template', () {
      expect(i18n.tpat('แสดง 10 จาก 240 รายการ', 'en'), 'Showing 10 of 240');
      expect(i18n.tpat('แสดง 10 จาก 240 รายการ', 'zh'), '显示 10 / 共 240');
      expect(i18n.tpat('แสดง 10 จาก 240 รายการ', 'ar'), 'عرض 10 من 240');
      expect(i18n.tpat('แสดง 10 จาก 240 รายการ', 'th'), 'แสดง 10 จาก 240 รายการ');
    });

    test('honours the second pattern and its \\d+ group', () {
      expect(i18n.tpat('กรอง · 7', 'en'), 'Filter · 7');
      expect(i18n.tpat('กรอง · 7', 'zh'), '筛选 · 7');
    });

    test('a non-matching sentence is returned unchanged', () {
      // Readable-but-untranslated beats blank: the gap is then visible, and
      // hasPatternFor lets a screen assert it instead of shipping it.
      expect(i18n.tpat('รอคุณอนุมัติ · ชั้นที่ 2 จาก 3', 'en'), 'รอคุณอนุมัติ · ชั้นที่ 2 จาก 3');
      expect(i18n.hasPatternFor('รอคุณอนุมัติ · ชั้นที่ 2 จาก 3'), isFalse);
      expect(i18n.hasPatternFor('กรอง · 7'), isTrue);
    });

    test('the \\d+ pattern does not match a non-numeric argument', () {
      expect(i18n.hasPatternFor('กรอง · ทั้งหมด'), isFalse);
    });

    test('a captured value is never re-expanded as a placeholder', () {
      // "$1" arriving as data must survive verbatim, not recurse.
      expect(i18n.tpat(r'แสดง $1 จาก 240 รายการ', 'en'), r'Showing $1 of 240');
    });

    test('an entry with no usable regex is dropped, not turned into a catch-all', () {
      // RegExp('') matches everything, so defaulting a missing "re" to '' would let
      // one malformed entry hijack tpat() for the whole app and make hasPatternFor
      // report coverage for every sentence. The block is hand-edited in the sacred
      // file under B-017 (a), so a typo there is a realistic input.
      final JuneflowI18n broken = JuneflowI18n.fromJsonString('''
{
  "langs": [], "dict": {}, "nav_i18n": {}, "phrases": {},
  "phrase_patterns": [
    {"flags": "", "en": "CATCHALL \$1"},
    {"re": "", "flags": "", "en": "ALSO CATCHALL"},
    {"re": null, "en": "NULL RE"},
    {"re": "^X (\\\\d+)\$", "flags": "", "en": "X \$1"}
  ]
}
''');
      expect(broken.patternCount, 1, reason: 'only the well-formed entry survives');
      expect(broken.tpat('X 7', 'en'), 'X 7');
      expect(broken.tpat('anything at all', 'en'), 'anything at all');
      expect(broken.hasPatternFor('anything at all'), isFalse);
    });

    test('an entry with non-string flags still parses', () {
      final JuneflowI18n odd = JuneflowI18n.fromJsonString('''
{
  "langs": [], "dict": {}, "nav_i18n": {}, "phrases": {},
  "phrase_patterns": [{"re": "^X (\\\\d+)\$", "flags": 0, "en": "X \$1"}]
}
''');
      expect(odd.patternCount, 1);
      expect(odd.tpat('X 7', 'en'), 'X 7');
    });

    test(r'applyTemplate leaves a lone $ and an unknown group visible', () {
      final RegExpMatch match = RegExp(r'^(\d+)$').firstMatch('42')!;
      expect(PhrasePattern.applyTemplate(r'cost $ is $1', match), r'cost $ is 42');
      // $9 names a group this pattern does not have. JavaScript's String.replace —
      // which authored these templates — leaves such a token alone, and a visible
      // $9 tells the author the pattern and template disagree, where deleting it
      // would ship a sentence with a silent hole.
      expect(PhrasePattern.applyTemplate(r'$1/$9', match), r'42/$9');
      // A digit run too long for int must not throw.
      expect(PhrasePattern.applyTemplate(r'$99999999999999999999', match), r'$99999999999999999999');
    });

    test('an odd language tag still resolves through its base', () {
      // Dart's Locale.toString() renders zh-TW as "zh_TW"; extra subtags are dropped.
      expect(JuneflowI18n.normalizeLang('zh_tw'), 'zh-TW');
      expect(JuneflowI18n.normalizeLang('zh-Hant-TW'), 'zh-HANT');
      expect(JuneflowI18n.normalizeLang('  '), 'th');
      expect(i18n.tn('งานหลัก', 'zh_TW'), '主要TW');
    });

    test('a wrong-typed block is treated as absent instead of throwing', () {
      final JuneflowI18n odd = JuneflowI18n.fromJsonString(
        '{"langs": {}, "dict": [], "nav_i18n": null, "phrases": {}, "phrase_patterns": "x"}',
      );
      expect(odd.langs, isEmpty);
      expect(odd.dictCount, 0);
      expect(odd.patternCount, 0);
      expect(odd.t('any.key', 'en'), 'any.key');
    });

    test('the constructor normalises its lang argument, like the setter does', () {
      final JuneflowI18n scoped = JuneflowI18n.fromJsonString(_fixture, lang: 'zh_tw');
      expect(scoped.lang, 'zh-TW');
      expect(scoped.tn('งานหลัก'), '主要TW');
    });
  });
}
