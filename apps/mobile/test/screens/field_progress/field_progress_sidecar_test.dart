// Asset-level test for the field-progress i18n sidecar.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// The sidecar is MIXED-LAYER (the approvals_inbox / pm_checklist / pm_notes
// precedent), so the two layers are asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist there.
//   * PHRASE fields are the Thai phrase itself, so for Thai (the default) tp()
//     returns them verbatim and the screen renders correctly TODAY; en/zh/ar light
//     up once Wei runs the sacred round from
//     agents/orch-d-recon/field-group-i18n.apply.json (B-296).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Fields read with t() — every value must be a stable id that already exists.
const List<String> _dictFields = <String>[
  'labelSubcon',
  'progressTitle',
  'unitPeriod',
  'statusLabel',
  // The four labels the WIRE status resolves through — zero-mint, reused from the
  // merged web port's own badge map so both clients say the same thing about the
  // same period. The status column is an English machine code and must never be
  // rendered raw (§0 rule 2); see field_progress_agg.dart statusLabelField.
  'statusNotReached',
  'statusRequested',
  'statusAccepted',
  'statusRejected',
  'deliver',
  'sent',
  'queued',
  'failed',
  'empty',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-screens.jsx MFieldProgress.
const Map<String, String> _phraseFields = <String, String>{
  'title': 'บันทึกความคืบหน้า', // L319
  'labelWork': 'งาน', // L324 (the label before the colon)
};

/// Dict slots whose resolved Thai must be BYTE-EXACT with the prototype line.
const Map<String, String> _verbatimDict = <String, String>{
  'labelSubcon': 'ผู้รับเหมา', // L323 (the label before the colon)
  'unitPeriod': 'งวด', // the ordinal word the view composes around the real seq
  // The status labels, byte-exact with what the merged web port renders for the
  // same wire values (apps/web subcon-accept.tsx BADGE_LABEL).
  'statusNotReached': 'ยังไม่ถึง', // pending
  'statusRequested': 'ขอตรวจรับ', // delivered | inspecting
  'statusAccepted': 'ตรวจรับแล้ว', // passed | paid
  'statusRejected': 'ตีกลับแก้ไข', // rejected
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the field_progress sidecar is bundled and carries the screen keys',
    () async {
      final ScreenStrings s = await ScreenStrings.load(
        'field_progress',
        bundle: rootBundle,
      );
      for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
        expect(s[f], isNotEmpty, reason: 'field_progress sidecar missing "$f"');
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
        'field_progress',
        bundle: rootBundle,
      );
      for (final String f in _dictFields) {
        final String key = s[f];
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
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'field_progress',
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
        'field_progress',
        bundle: rootBundle,
      );
      for (final MapEntry<String, String> e in _phraseFields.entries) {
        expect(
          s[e.key],
          e.value,
          reason: '"${e.key}" must stay byte-exact with the prototype',
        );
        expect(i18n.tp(s[e.key]), e.value);
      }
    },
  );

  test('no slot can smuggle a progress percentage or an amount back in', () async {
    // The prototype's CTA is 'ขออนุมัติงวด · 645,000 ฿' (L353) and its progress
    // section carries '78%' / 'เดิม 65%' / '+13 ppt วันนี้' (L331/L334). None of that
    // is keyed: the money is client-side math (money = SERVER) and the percentage has
    // no column at all. Assert on the RESOLVED text, because pointing a slot at an
    // existing dict id whose Thai contains such a template would reintroduce the
    // claim while the sidecar still read as key-only.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'field_progress',
      bundle: rootBundle,
    );
    for (final String name in s.names) {
      final String rendered = _dictFields.contains(name)
          ? i18n.t(s[name])
          : i18n.tp(s[name]);
      for (final String claim in <String>[
        '%',
        '฿',
        'ppt',
        '{amount}',
        '{pct}',
      ]) {
        expect(
          rendered,
          isNot(contains(claim)),
          reason: '"$name" (${s[name]}) renders "$claim" — nothing backs it',
        );
      }
    }
  });
}
