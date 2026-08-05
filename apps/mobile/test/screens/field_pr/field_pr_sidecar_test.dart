// Asset-level test for the field-pr i18n sidecar.
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
  'fieldNo',
  'fieldQty',
  'submit',
  'submitted',
  'draftOnly',
  'failed',
  'empty',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-screens.jsx MFieldQuickPR.
const Map<String, String> _phraseFields = <String, String>{
  'title': 'ขอซื้อด่วน', // L432
  'sub': 'PR ด่วนจากหน้างาน', // L432
  'fieldBoq': 'เลือกจาก BOQ', // L436
  'fieldItems': 'รายการที่ขอซื้อ', // L441
  'fieldUrgency': 'ความเร่งด่วน', // L450
  'fieldPhotos': 'รูปประกอบ + เหตุผล', // L456
};

/// Dict slots whose resolved Thai is asserted because the SCREEN depends on the
/// exact meaning, not just on the id resolving.
const Map<String, String> _verbatimDict = <String, String>{
  // The draft-only outcome: the PR really exists, as a draft. If this id ever drifts
  // to generic success or generic failure copy, the screen starts lying about a
  // document it just created — the exact case that produces a duplicate PR.
  'draftOnly': 'บันทึกร่างแล้ว',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the field_pr sidecar is bundled and carries the screen keys', () async {
    final ScreenStrings s = await ScreenStrings.load(
      'field_pr',
      bundle: rootBundle,
    );
    for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
      expect(s[f], isNotEmpty, reason: 'field_pr sidecar missing "$f"');
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
        'field_pr',
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

  test(
    'the load-bearing dict copy is byte-identical to what it claims',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'field_pr',
        bundle: rootBundle,
      );
      for (final MapEntry<String, String> e in _verbatimDict.entries) {
        expect(
          i18n.t(s[e.key]),
          e.value,
          reason: '"${e.key}" (${s[e.key]}) must keep meaning exactly this',
        );
      }
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
        'field_pr',
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

  test('the dropped approval-chain CLAIM cannot re-enter through the sidecar', () async {
    // The prototype's info card (L464-469) states a chain ending "(วงเงิน ≥ 100K)".
    // The implemented tiers are 500,000 / 2,000,000 (pr.ts B-070), so that text is a
    // FALSE claim about the requester's own document, not a missing value — dropped,
    // never keyed. Assert on the RESOLVED text: pointing a slot at an existing dict
    // id whose Thai carries the same claim would smuggle it back in while the sidecar
    // still read as key-only.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'field_pr',
      bundle: rootBundle,
    );
    for (final String name in s.names) {
      final String rendered = _dictFields.contains(name)
          ? i18n.t(s[name])
          : i18n.tp(s[name]);
      for (final String claim in <String>[
        '100K',
        'วงเงิน',
        'ผอ.ก่อสร้าง',
        'หน.จัดซื้อ',
        '฿',
        '{amount}',
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
