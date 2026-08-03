// Tests for the per-screen key sidecars (MOB-I18N-01).
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's values ARE Thai keys. Every Thai
// string below is copied byte-for-byte out of docs/extract/i18n-full.json.
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

const String _sidecar = '''
{
  "_source": "documentation field — skipped by ScreenStrings",
  "filterAll": "ทั้งหมด",
  "filterUrgent": "ด่วน",
  "cancel": "common.cancel"
}
''';

void main() {
  final ScreenStrings s = ScreenStrings.fromJsonString(_sidecar, assetPath: 'test/inline');

  test('exposes the declared keys and skips _-prefixed documentation fields', () {
    expect(s.names.toSet(), <String>{'filterAll', 'filterUrgent', 'cancel'});
  });

  test('returns keys verbatim — a sidecar carries keys, never translations', () {
    expect(s['filterAll'], 'ทั้งหมด'); // phrases layer: the Thai text IS the key
    expect(s['cancel'], 'common.cancel'); // dict layer: a stable id
  });

  test('a missing entry throws instead of rendering blank', () {
    // PLAN.md §0 rule 2: a string with no key is a BLOCKERS.md case, so this has
    // to fail loudly in development rather than ship an empty label.
    expect(() => s['nope'], throwsStateError);
    expect(
      () => s['nope'],
      throwsA(isA<StateError>().having((StateError e) => e.message, 'message', contains('test/inline'))),
    );
  });

  test('maybe() gives an optional slot its null instead', () {
    expect(s.maybe('nope'), isNull);
    expect(s.maybe('filterUrgent'), 'ด่วน');
  });

  test('feeds straight into the translator', () {
    final JuneflowI18n i18n = JuneflowI18n.fromJsonString('''
{
  "langs": [{"code": "en", "label": "English", "en": "English", "dir": "ltr"}],
  "dict": {"common.cancel": {"th": "ยกเลิก", "en": "Cancel"}},
  "nav_i18n": {},
  "phrases": {"ทั้งหมด": {"en": "All"}},
  "phrase_patterns": []
}
''');
    expect(i18n.tp(s['filterAll'], 'en'), 'All');
    expect(i18n.t(s['cancel'], 'en'), 'Cancel');
  });
}
