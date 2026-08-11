// Asset-level test for the fm-accept i18n sidecar.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// The sidecar is MIXED-LAYER (the approvals_inbox / pm_checklist / pm_notes
// precedent), so the two layers are asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist there, i.e.
//     an un-approved mint. This is the ZERO-MINT guarantee for those slots.
//   * PHRASE fields are the Thai phrase itself, so for Thai (the default) tp()
//     returns them verbatim and the screen renders correctly TODAY; en/zh/ar light
//     up once Wei runs the sacred round from
//     agents/orch-d-recon/field-group-i18n.apply.json (B-296).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Fields read with t() — every value must be a stable id that already exists.
const List<String> _dictFields = <String>[
  'centre',
  'tabAll',
  'unitPeriod',
  'failed',
  'empty',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-field.jsx MFmAccept.
const Map<String, String> _phraseFields = <String, String>{
  'title': 'รอตรวจรับ', // L153
  'tabWait': 'รอตรวจ', // L155
  'tabRejected':
      'ตีกลับ', // L155 (the tab's own word, minus the ⚠ the view adds)
  'pillPeriod': 'งวดงาน', // L164
  'pillGr': 'รับของ', // L164
  'pillRejected': 'ตีกลับ', // L165
  'btnPass': 'ตรวจรับผ่าน', // L176
  'btnReject': 'ตีกลับ', // L177
};

/// Dict slots whose resolved Thai must be BYTE-EXACT with the prototype line,
/// because they are the prototype's own copy reused zero-mint.
const Map<String, String> _verbatimDict = <String, String>{
  // L153 eyebrow, first half (its trailing site name is mock and is dropped).
  'centre': 'ศูนย์ตรวจรับ',
  // L155 first tab, minus the "(n)" count the view composes from real rows.
  'tabAll': 'ทั้งหมด',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the fm_accept sidecar is bundled and carries the screen keys',
    () async {
      final ScreenStrings s = await ScreenStrings.load(
        'fm_accept',
        bundle: rootBundle,
      );
      for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
        expect(s[f], isNotEmpty, reason: 'fm_accept sidecar missing "$f"');
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
        'fm_accept',
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
    // The whole point of reusing an existing id: it already holds the prototype's
    // exact words. If a dict value ever drifts, this screen silently stops matching
    // the prototype — so assert it, do not assume it.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'fm_accept',
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
        'fm_accept',
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

  test('the dropped done-banner CLAIM cannot re-enter through the sidecar', () async {
    // The prototype's post-action banner (L173) reads "✓ ตรวจแล้ว · ส่งผลเข้าระบบ"
    // and is set by a LOCAL boolean (setDone, L150/L176) while nothing was sent. It
    // is dropped rather than keyed: a claim that a result reached the system, made
    // without sending anything, is a fabrication — this port proves success by
    // re-reading the queue instead.
    //
    // Assert on the RESOLVED text, not on the raw slot value: pointing a slot at an
    // existing dict id whose Thai happens to contain the claim would smuggle it back
    // in while the sidecar still read as key-only.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'fm_accept',
      bundle: rootBundle,
    );
    for (final String name in s.names) {
      final String rendered = _dictFields.contains(name)
          ? i18n.t(s[name])
          : i18n.tp(s[name]);
      for (final String claim in <String>[
        'ตรวจแล้ว',
        'ส่งผลเข้าระบบ',
        'sync',
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
