// Asset-level test for the exec i18n sidecar.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// The sidecar is MIXED-LAYER (the approvals_inbox / pm_checklist / pm_notes
// precedent), so the two layers are asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist, i.e. an
//     un-approved mint. This is the ZERO-MINT guarantee for those slots.
//   * PHRASE fields are the Thai phrase itself, so for Thai (the default) tp()
//     returns them verbatim. The sacred round from
//     agents/orch-d-recon/exec-i18n.apply.json (B-298) was APPLIED on 2026-08-05,
//     so en/zh/ar now resolve too — before that they rendered raw Thai.
import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Fields read with t() — every value must be a stable id that already exists.
const List<String> _dictFields = <String>[
  'heroLabel',
  'unitJobs',
  'unitBaht',
  'today',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-screens.jsx MExecDashboard.
const Map<String, String> _phraseFields = <String, String>{
  'title': 'Dashboard', // L650
  'heroUnits': 'ยูนิตขายแล้ว', // L660
  'kpiCash': 'กระแสเงินสด 7 วัน', // L666
  'kpiPending': 'เอกสารรออนุมัติ', // L667
  'kpiDue': 'Project ใกล้กำหนด', // L668
  'kpiSalesMonth': 'ขายเดือนนี้', // L669
  'unitMBaht': 'M ฿', // L666 / L669
  'unitDocs': 'ฉบับ', // L667 / L694
  'scurveTitle': 'S-Curve ความคืบหน้า', // L680
  'legendPlan': 'แผน', // L690
  'legendActual': 'จริง', // L691
  'approvalsTitle': 'รออนุมัติของฉัน', // L694
};

/// Dict slots whose resolved Thai must be BYTE-EXACT with the prototype line,
/// because they are the prototype's own copy reused zero-mint.
const Map<String, String> _verbatimDict = <String, String>{
  'unitJobs': 'งาน', // L668
  'unitBaht': '฿', // L705
  'today': 'วันนี้', // L687 (the prototype prefixes U+2191, added as chrome)
};

/// Phrase slots that must already exist in the sacred file — these are the
/// ZERO-MINT reuses, and if one ever stops resolving the mint list is wrong.
///
/// The seven slots below the original five were MINTED on 2026-08-05 under the
/// standing pre-ratification (phrases 1065 -> 1099, all three copies of
/// i18n-full.json byte-identical). They moved here from _mintedPhrases the moment
/// they landed, which is exactly what the assertion below demanded: a slot that is
/// present in the sacred file is no longer a mint. Until then tp() rendered them
/// correctly in Thai only because it echoes the key — en/zh/ar saw raw Thai.
const List<String> _zeroMintPhrases = <String>[
  'title',
  'kpiPending',
  'unitMBaht',
  'unitDocs',
  'legendPlan',
  'heroUnits',
  'kpiCash',
  'kpiDue',
  'kpiSalesMonth',
  'scurveTitle',
  'legendActual',
  'approvalsTitle',
];

/// Phrase slots still awaiting a mint (staged in exec-i18n.apply.json).
/// Empty: this screen's mint round is applied. Anything added here must be absent
/// from the sacred file, or the assertion below fails — that is the point.
const List<String> _mintedPhrases = <String>[];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the exec sidecar is bundled and carries exactly the screen keys',
    () async {
      final ScreenStrings s = await ScreenStrings.load(
        'exec',
        bundle: rootBundle,
      );
      for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
        expect(s[f], isNotEmpty, reason: 'exec sidecar missing "$f"');
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
        'exec',
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
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'exec',
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
        'exec',
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

  test('the mint list is exactly right — asserted against the sacred file', () async {
    // The mint list is a CLAIM about docs/extract/i18n-full.json, so it is
    // checked by KEY MEMBERSHIP in the bundled copy of that file rather than by
    // whether a lookup "resolves". A resolve-based heuristic is WRONG here, and
    // this test caught it: a unit symbol translates to ITSELF ('M ฿' is 'M ฿' in
    // en/zh/ar), so a present entry was indistinguishable from a missing one and
    // the zero-mint claim failed against a key that does exist.
    final Map<String, dynamic> full =
        jsonDecode(await rootBundle.loadString(kI18nAssetPath))
            as Map<String, dynamic>;
    final Map<String, dynamic> phrases =
        full['phrases'] as Map<String, dynamic>;
    final ScreenStrings s = await ScreenStrings.load(
      'exec',
      bundle: rootBundle,
    );

    for (final String f in _zeroMintPhrases) {
      expect(
        phrases.containsKey(s[f]),
        isTrue,
        reason: '"$f" (${s[f]}) is listed zero-mint but is NOT in phrases',
      );
    }
    for (final String f in _mintedPhrases) {
      expect(
        phrases.containsKey(s[f]),
        isFalse,
        reason:
            '"$f" (${s[f]}) is already in phrases — it is no longer a mint, so '
            'drop it from agents/orch-d-recon/exec-i18n.apply.json',
      );
    }
    // Every phrase slot is accounted for as either zero-mint or minted.
    expect(<String>{
      ..._zeroMintPhrases,
      ..._mintedPhrases,
    }, _phraseFields.keys.toSet());
  });

  test('no dropped CLAIM can re-enter through the sidecar', () async {
    // Four prototype strings are dropped rather than keyed, each because it is a
    // claim and a claim cannot be em-dashed the way a missing value can:
    //   * 'อนุมัติ' (L708) — a one-tap approve this READ screen cannot perform.
    //     Note it WOULD have been zero-mint (phrases 'อนุมัติ' and dict
    //     common.approve both exist), so only an assertion on the RESOLVED text
    //     catches a slot being quietly repointed at one of them. Matched
    //     EXACTLY — see the comment at the assertion.
    //   * 'YoY' (L661) — a growth delta with no feed. The dict even holds a
    //     template (dashboard.tplDeltaYoY) that must not be pulled in.
    //   * the mock's own hero/KPI numbers, which are data, not copy.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'exec',
      bundle: rootBundle,
    );
    for (final String name in s.names) {
      // Resolved exactly the way the screen resolves that slot.
      final String rendered = _dictFields.contains(name)
          ? i18n.t(s[name])
          : i18n.tp(s[name]);
      // EXACT match, not substring: 'อนุมัติ' (approve) is a legitimate part of
      // this screen's own honest copy — 'เอกสารรออนุมัติ' (tile 2) and
      // 'รออนุมัติของฉัน' (the section title) both contain it. A contains-check
      // flagged those two, which is a false positive, not a finding; what must
      // never appear is a slot whose whole rendered text IS the button label.
      for (final String claim in <String>['อนุมัติ']) {
        expect(
          rendered,
          isNot(equals(claim)),
          reason:
              '"$name" (${s[name]}) renders the dropped APPROVE button label',
        );
      }
      // These are distinctive enough that any occurrence is a fabrication.
      for (final String claim in <String>['YoY', '284.5', '148/240', '2569']) {
        expect(
          rendered,
          isNot(contains(claim)),
          reason: '"$name" (${s[name]}) renders "$claim" — nothing backs it',
        );
      }
    }
  });
}
