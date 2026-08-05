// Asset-level tests for the four after-sales SERVICE i18n sidecars, plus the route
// registrations the group adds.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// Each sidecar is MIXED-LAYER (the approvals_inbox / pm_checklist / pm_notes
// precedent), so the two layers are asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist there, i.e. an
//     un-approved mint. This is the ZERO-MINT guarantee for those slots.
//   * PHRASE fields are the Thai phrase itself, byte-exact with the prototype line,
//     so for Thai (the default) tp() returns them verbatim and the screens render
//     correctly TODAY; en/zh/ar light up once Wei runs the sacred round from
//     agents/orch-d-recon/service-group-i18n.apply.json (BLOCKERS.md B-292).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';
import 'package:juneflow_mobile/shell/mobile_routes.dart';
import 'package:juneflow_mobile/shell/mobile_screen_router.dart';

/// Per sidecar: the dict-layer fields (read with t()) and the phrase-layer fields
/// (read with tp()) mapped to their byte-exact prototype text.
const Map<String, List<String>> _dictFields = <String, List<String>>{
  'srv_track': <String>[
    'statusReceived',
    'statusScheduled',
    'statusFixing',
    'statusFixed',
    'statusClosed',
    'warrantyDelivered',
    'warrantyLeft',
    'monthsSuffix',
  ],
  'tech_jobs': <String>[
    'statToday',
    'statUrgent',
    'btnSchedule',
    'btnStart',
    'statusReceived',
    'statusScheduled',
    'statusFixing',
    'statusFixed',
    'statusClosed',
    'failed',
  ],
  'srv_new': <String>[
    'catPlumbing',
    'catElectrical',
    'catPaint',
    'catWindowDoor',
    'catAircon',
    'catFloorTile',
    'saved',
    'failed',
  ],
  'tech_close': <String>[
    'btnFix',
    'btnClose',
    'btnClosedDone',
    'saved',
    'failed',
  ],
};

/// Phrase-layer slots. Every value below was grepped out of the raw
/// pototype/mobile-screens.jsx this round at the cited line.
const Map<String, Map<String, String>> _phraseFields =
    <String, Map<String, String>>{
      'srv_track': <String, String>{
        'eyebrow': 'ลูกบ้าน', // L128
        'title': 'ติดตามแจ้งซ่อม', // L128
        'historyTitle': 'ประวัติการซ่อม', // L161
      },
      'tech_jobs': <String, String>{
        'title': 'งานของฉัน', // L207
        'btnClose': 'ปิดงานซ่อม', // L266 (the tech-close title it opens)
      },
      'srv_new': <String, String>{
        'eyebrow': 'ลูกบ้าน · แจ้งซ่อม', // L68
        'title': 'แจ้งซ่อมใหม่', // L68
        'fieldUnit': 'ยูนิตของฉัน', // L72
        'fieldCategory': 'เลือกหมวด', // L75
        'fieldProblem': 'คำอธิบายปัญหา', // L89
        'submit': 'ส่งแจ้งซ่อม', // L114
      },
      'tech_close': <String, String>{
        'title': 'ปิดงานซ่อม', // L266
        'fieldBefore': 'ก่อนซ่อม', // L270
        'fieldAfter': 'หลังซ่อม', // L276
        'fieldWorkDetails': 'รายละเอียดงานที่ทำ', // L282
        'fieldMaterials': 'วัสดุที่ใช้', // L285
        'signatureTitle': 'ลายเซ็นรับงานจากลูกค้า', // L292
      },
    };

/// Dict slots whose RESOLVED Thai must be byte-exact with the prototype line, because
/// they are the prototype's own copy reused zero-mint through the merged web port's
/// dict. If a dict value ever drifts, a screen silently stops matching the prototype —
/// so assert it, do not assume it.
const Map<String, Map<String, String>> _verbatimDict =
    <String, Map<String, String>>{
      'srv_track': <String, String>{
        'statusReceived': 'รับเรื่อง', // L141
        'statusScheduled': 'นัดช่าง', // L142
        'statusFixing': 'กำลังซ่อม', // L143 (and the pill, L137)
        'statusFixed': 'ซ่อมเสร็จ', // L144
        'statusClosed': 'ปิดงาน', // L145
        'warrantyDelivered': 'ส่งมอบ', // L182 (minus the mock's inline colon)
        'warrantyLeft': 'Warranty คงเหลือ', // L185 (same)
      },
      'tech_jobs': <String, String>{
        'statToday': 'วันนี้', // L214
        'statUrgent': 'ด่วน', // L215
        'btnStart': 'เริ่มซ่อม', // L243
        'statusReceived': 'รับเรื่อง', // L239
        'statusFixing': 'กำลังซ่อม', // L237
      },
    };

/// Claims no slot of any service sidecar may render, because nothing backs them.
/// Asserted on the RESOLVED text, not the raw slot value: pointing a slot at an
/// existing dict id would smuggle the same claim back in while the sidecar still read
/// as key-only (the pm-notes B-285 precedent).
const List<String> _forbiddenClaims = <String>[
  'ส่งแบบประเมิน', // no rating column; close throws the client rating away (B-294)
  'เลื่อนนัด', // no reschedule op exists at all (B-294)
  'นัดลูกค้า', // nothing notifies a customer anywhere in this route
  'บันทึกร่าง', // the machine has no draft state
  'รูปประกอบ', // no photo column, no upload seam (B-293)
  'เซ็นที่นี่', // no signature column, and no pad is drawn (B-294)
  'เรตติ้ง', // no rating column (B-294)
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final String screen in _dictFields.keys) {
    group('$screen sidecar', () {
      test('is bundled and carries exactly the screen\'s keys', () async {
        final ScreenStrings s = await ScreenStrings.load(
          screen,
          bundle: rootBundle,
        );
        final Set<String> expected = <String>{
          ..._dictFields[screen]!,
          ..._phraseFields[screen]!.keys,
        };
        for (final String f in expected) {
          expect(s[f], isNotEmpty, reason: '$screen sidecar missing "$f"');
        }
        // No stray field: the screen reads exactly these.
        expect(s.names.toSet(), expected);
      });

      test('every dict field is a real stable id (zero-mint)', () async {
        final JuneflowI18n i18n = await JuneflowI18n.load(
          bundle: rootBundle,
          lang: 'th',
        );
        final ScreenStrings s = await ScreenStrings.load(
          screen,
          bundle: rootBundle,
        );
        for (final String f in _dictFields[screen]!) {
          final String key = s[f];
          // t() returns the key verbatim ONLY when it is missing from the dict.
          expect(
            i18n.t(key),
            isNot(key),
            reason:
                't("$key") must resolve — the key must exist in i18n-full.json',
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
            screen,
            bundle: rootBundle,
          );
          for (final MapEntry<String, String> e
              in _phraseFields[screen]!.entries) {
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

      test('no dropped PROMISE can re-enter through the sidecar', () async {
        final JuneflowI18n i18n = await JuneflowI18n.load(
          bundle: rootBundle,
          lang: 'th',
        );
        final ScreenStrings s = await ScreenStrings.load(
          screen,
          bundle: rootBundle,
        );
        final List<String> dict = _dictFields[screen]!;
        for (final String name in s.names) {
          // Resolved exactly the way the screen resolves that slot.
          final String rendered = dict.contains(name)
              ? i18n.t(s[name])
              : i18n.tp(s[name]);
          for (final String claim in _forbiddenClaims) {
            expect(
              rendered,
              isNot(contains(claim)),
              reason:
                  '"$name" (${s[name]}) renders "$claim" — nothing backs it',
            );
          }
        }
      });
    });
  }

  test(
    'the reused dict copy is byte-identical to the prototype line',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      for (final MapEntry<String, Map<String, String>> screen
          in _verbatimDict.entries) {
        if (screen.value.isEmpty) continue;
        final ScreenStrings s = await ScreenStrings.load(
          screen.key,
          bundle: rootBundle,
        );
        for (final MapEntry<String, String> e in screen.value.entries) {
          expect(
            i18n.t(s[e.key]),
            e.value,
            reason:
                '${screen.key}."${e.key}" (${s[e.key]}) must stay byte-exact '
                'with the prototype',
          );
        }
      }
    },
  );

  test('the four service routes are built and registered', () {
    for (final String id in <String>[
      'srv-track',
      'tech-jobs',
      'srv-new',
      'tech-close',
    ]) {
      expect(kMobileRouteIds, contains(id), reason: '$id is a known route');
      expect(kBuiltRouteIds, contains(id), reason: '$id must be built');
      expect(
        mobileScreenBuilders.containsKey(id),
        isTrue,
        reason: '$id needs a builder',
      );
    }
    // The shared invariant the shell test also pins: the two sets stay equal.
    expect(mobileScreenBuilders.keys.toSet(), kBuiltRouteIds);
  });
}
