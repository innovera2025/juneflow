// Asset-level test for the pm-notes i18n sidecar.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// The sidecar is MIXED-LAYER (the approvals_inbox / pm_checklist precedent), so the
// two layers are asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist there, i.e. an
//     un-approved mint. This is the ZERO-MINT guarantee for those slots.
//   * PHRASE fields are the Thai phrase itself, so for Thai (the default) tp()
//     returns them verbatim and the screen renders correctly TODAY; en/zh/ar light up
//     once Wei runs the sacred round from
//     agents/orch-d-recon/pm-notes-i18n.apply.json (B-280).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Fields read with t() — every value must be a stable id that already exists.
const List<String> _dictFields = <String>[
  'title',
  'fieldCause',
  'phCause',
  'fieldFix',
  'phFix',
  'fieldAdvice',
  'phAdvice',
  'saved',
  'queued',
  'failed',
  'next',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-pm.jsx MPMNotes (L161 / L175).
const Map<String, String> _phraseFields = <String, String>{
  'fieldParts': 'อะไหล่ที่ใช้',
  'closeNext': 'ไปสรุป + ปิดงาน',
};

/// Dict slots whose resolved Thai must be BYTE-EXACT with the prototype line, because
/// they are the prototype's own copy reused zero-mint (mobile-pm.jsx L150/152/155/158).
const Map<String, String> _verbatimDict = <String, String>{
  'title': 'บันทึกการบำรุงรักษา',
  'fieldCause': 'สาเหตุการเสีย / ความผิดปกติ',
  'fieldFix': 'การแก้ไข / งานที่ทำ',
  'fieldAdvice': 'ข้อเสนอแนะ / งานที่ควรทำเพิ่ม',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the pm_notes sidecar is bundled and carries the screen keys', () async {
    final ScreenStrings s = await ScreenStrings.load(
      'pm_notes',
      bundle: rootBundle,
    );
    for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
      expect(s[f], isNotEmpty, reason: 'pm_notes sidecar missing "$f"');
    }
    // No stray field: the screen reads exactly these.
    expect(s.names.toSet(), <String>{..._dictFields, ..._phraseFields.keys});
  });

  test(
    'every dict field is a real stable id (zero-mint — resolves to text)',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_notes',
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

  test('the reused dict copy is byte-identical to the prototype line', () async {
    // The whole point of the near-total zero-mint: the merged web PM screen renders
    // the same maintenance log, so its keys already hold the prototype's exact
    // words. If a dict value ever drifts, this screen silently stops matching the
    // prototype — so assert it, do not assume it.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'pm_notes',
      bundle: rootBundle,
    );
    for (final MapEntry<String, String> e in _verbatimDict.entries) {
      expect(
        i18n.t(s[e.key]),
        e.value,
        reason:
            '"${e.key}" (${s[e.key]}) must stay byte-exact with the prototype',
      );
    }
  });

  test(
    'phrase fields are the prototype text verbatim and render today',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_notes',
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

  test('the dropped banner is not represented in the sidecar', () async {
    // mobile-pm.jsx L169-171 promises an automation that does not exist (nothing
    // auto-raises a pmQuote; LINE is a verified no-op stub — pm.ts lineNotifyStub,
    // B-108b). It is DROPPED, not minted: a key here would mean the screen is one
    // edit away from making the claim again.
    final ScreenStrings s = await ScreenStrings.load(
      'pm_notes',
      bundle: rootBundle,
    );
    for (final String name in s.names) {
      expect(s[name], isNot(contains('LINE OA')));
      expect(s[name], isNot(contains('ใบเสนอราคา')));
    }
  });
}
