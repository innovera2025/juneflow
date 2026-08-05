// Asset-level test for the pm-checklist i18n sidecar.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// The sidecar is MIXED-LAYER (the approvals_inbox precedent), so the two layers are
// asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist there, i.e.
//     an un-approved mint. This is the ZERO-MINT guarantee for those slots.
//   * PHRASE fields are the Thai phrase itself, so for Thai (the default) tp()
//     returns them verbatim and the screen renders correctly TODAY; en/zh/ar light
//     up once Wei runs the sacred round from
//     agents/orch-d-recon/pm-checklist-i18n.apply.json.
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Fields read with t() — every value must be a stable id that already exists.
const List<String> _dictFields = <String>[
  'photoBefore',
  'emptyChecklist',
  'saved',
  'queued',
  'failed',
  'next',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-pm.jsx MPMChecklist (L94/95/96/105/124/141).
const Map<String, String> _phraseFields = <String, String>{
  'title': 'Checklist PM',
  'progress': 'ตรวจแล้ว {n}/{count}',
  'photoAfter': 'รูป/วิดีโอหลัง',
  'resultNormal': 'ปกติ',
  'resultAdjust': 'ปรับตั้ง',
  'resultRepair': 'เปลี่ยน/ซ่อม',
  'saveNext': 'บันทึกผล + ต่อไป',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the pm_checklist sidecar is bundled and carries the screen keys',
    () async {
      final ScreenStrings s = await ScreenStrings.load(
        'pm_checklist',
        bundle: rootBundle,
      );
      for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
        expect(s[f], isNotEmpty, reason: 'pm_checklist sidecar missing "$f"');
      }
      // No stray field: the screen reads exactly these.
      expect(s.names.toSet(), <String>{..._dictFields, ..._phraseFields.keys});
    },
  );

  test(
    'every dict field is a real stable id (zero-mint — resolves to text)',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_checklist',
        bundle: rootBundle,
      );
      for (final String f in _dictFields) {
        final String key = s[f];
        // t() returns the key verbatim ONLY when it is missing from the dict.
        expect(
          i18n.t(key),
          isNot(key),
          reason:
              't("$key") must resolve — the key must exist in i18n-full.json',
        );
      }
    },
  );

  test(
    'photoBefore reuses the dict entry whose th IS the prototype text',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_checklist',
        bundle: rootBundle,
      );
      // mobile-pm.jsx L120 renders 'รูปก่อน'; subcon.photoBefore.th is byte-identical,
      // so the slot is zero-mint AND pixel-faithful.
      expect(s['photoBefore'], 'subcon.photoBefore');
      expect(i18n.t(s['photoBefore']), 'รูปก่อน');
    },
  );

  test(
    'phrase fields are the prototype text verbatim and render today',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_checklist',
        bundle: rootBundle,
      );
      for (final MapEntry<String, String> e in _phraseFields.entries) {
        expect(
          s[e.key],
          e.value,
          reason: '"${e.key}" must stay byte-exact with the prototype',
        );
        // phrases layer: for Thai the key IS the text, so tp echoes it.
        expect(i18n.tp(s[e.key]), e.value);
      }
    },
  );

  test('the progress composite keeps BOTH runtime tokens', () async {
    final ScreenStrings s = await ScreenStrings.load(
      'pm_checklist',
      bundle: rootBundle,
    );
    final String template = s['progress'];
    expect(template, contains('{n}'));
    expect(template, contains('{count}'));
    expect(
      JuneflowI18n.format(template, <String, Object?>{'n': 2, 'count': 5}),
      'ตรวจแล้ว 2/5',
    );
  });
}
