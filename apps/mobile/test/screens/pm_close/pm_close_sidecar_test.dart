// Asset-level test for the pm-close i18n sidecar.
//
// Thai literals are legitimate here: *_test.dart is exempt from
// .claude/hooks/i18n-guard.sh, and a sidecar's phrase values ARE Thai keys.
//
// The sidecar is MIXED-LAYER (the approvals_inbox / pm_checklist / pm_notes
// precedent), so the two layers are asserted differently:
//   * DICT fields must resolve to real text through the sacred i18n-full.json —
//     t() echoing the key back would mean the stable id does not exist there, i.e. an
//     un-approved mint. This is the ZERO-MINT guarantee for those slots.
//   * PHRASE fields are the Thai phrase itself, so for Thai (the default) tp()
//     returns them verbatim and the screen renders correctly TODAY; en/zh/ar light up
//     once Wei runs the sacred round from
//     agents/orch-d-recon/pm-close-i18n.apply.json (B-287).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Fields read with t() / tf() — every value must be a stable id that already exists.
const List<String> _dictFields = <String>[
  'rowAsset',
  'checkProgress',
  'rowTotalTime',
  'signatureTitle',
  'close',
  // B-331 added these three when the CTA became a real close. All are EXISTING dict
  // ids already carrying these states on pm-checkin / pm-checklist / pm-notes, so
  // this screen still mints nothing.
  'closed',
  'queued',
  'failed',
];

/// Fields read with tp() — the Thai phrase IS the key, byte-exact with
/// pototype/mobile-pm.jsx MPMClose (L197 / L200 / L201 / L209).
const Map<String, String> _phraseFields = <String, String>{
  'title': 'สรุป + ปิดงาน',
  'summaryTitle': 'สรุปงาน',
  'rowChecks': 'ผลตรวจ',
  'repairCount': 'ซ่อม {n}',
  'rowTime': 'เริ่ม-เสร็จ',
  'rowParts': 'อะไหล่',
  'recipient': 'ผู้รับบริการ',
};

/// Dict slots whose resolved Thai must be BYTE-EXACT with the prototype line, because
/// they are the prototype's own copy reused zero-mint (mobile-pm.jsx L201 / L205).
const Map<String, String> _verbatimDict = <String, String>{
  'rowAsset': 'อุปกรณ์',
  'rowTotalTime': 'รวมเวลา',
  'signatureTitle': 'ลายเซ็นลูกค้า / ผู้ดูแลอาคาร',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the pm_close sidecar is bundled and carries the screen keys', () async {
    final ScreenStrings s = await ScreenStrings.load(
      'pm_close',
      bundle: rootBundle,
    );
    for (final String f in <String>[..._dictFields, ..._phraseFields.keys]) {
      expect(s[f], isNotEmpty, reason: 'pm_close sidecar missing "$f"');
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
        'pm_close',
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
    // The point of the zero-mint reuse: the merged web PM screens render this same
    // close panel, so their keys already hold the prototype's exact words. If a dict
    // value ever drifts, this screen silently stops matching the prototype — so
    // assert it, do not assume it.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'pm_close',
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
    'the count key still carries BOTH placeholders the screen substitutes',
    () async {
      // pm.checkProgress is an existing dict entry ("{n}/{count} รายการ"). The screen
      // feeds it n=checked and count=total through tf(). If the entry ever lost a
      // placeholder the row would silently render a literal "{count}" — so pin it.
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_close',
        bundle: rootBundle,
      );
      final String template = i18n.t(s['checkProgress']);
      expect(template, contains('{n}'));
      expect(template, contains('{count}'));
      expect(
        i18n.tf(s['checkProgress'], <String, Object?>{'n': 2, 'count': 5}),
        '2/5 รายการ',
      );
      // The minted repair tail carries its own {n}.
      expect(s['repairCount'], contains('{n}'));
      expect(
        JuneflowI18n.format(s['repairCount'], <String, Object?>{'n': 1}),
        'ซ่อม 1',
      );
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
        'pm_close',
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

  test('no dropped CLAIM can re-enter through the sidecar', () async {
    // Three prototype strings are dropped rather than keyed, because each is a claim
    // and a claim cannot be em-dashed the way a missing value can:
    //   * the success heading (L189, 'ปิดงาน PM สำเร็จ') — it announces an outcome
    //     over a certificate that does not exist;
    //   * its subtitle's second line (L190) — no certificate exists and LINE is a
    //     verified no-op stub (pm.ts lineNotifyStub, B-108b);
    //   * the CTA label (L213, 'ปิดงาน PM + ส่งรายงาน') — the report half is that
    //     same LINE promise.
    // Assert on the RESOLVED text, not the raw slot value: pointing a slot at an
    // existing dict id (pm.toastClosed) would smuggle the same claim back in while
    // the sidecar still read as key-only. pm.toastClosed is the live example — it
    // reads 'closed · the report was sent to the customer', and its second half is
    // exactly the LINE promise, so no slot may resolve to it.
    //
    // THE WEB SCREEN NO LONGER CONTRADICTS THIS (B-357/F5). Until that round
    // apps/web/src/screens/pm/wo-detail.tsx rendered pm.toastClosed WHOLE on the same
    // close this screen performs, so the two clients stated opposite things about one
    // event: mobile 'the customer signed', web 'the report was sent'. One of them was
    // false, and it was the one in a file this test forbids. Web now drops the clause
    // at render (closeToastText, the merged st-receive B-266 omit-the-unbacked-clause
    // ruling), so NO surface prints it on any platform. What is still true is what
    // this list asserts: the KEY's stored value carries the claim, which is why no
    // slot here may resolve to it. Retiring the clause from the dict itself needs a
    // sacred i18n round — B-359.
    //
    // TWO WORDS LEFT THIS LIST UNDER B-331, and neither left quietly:
    //   * 'ปิดงานแล้ว' — pm.closedNote. Under B-288 it was forbidden because nothing
    //     could ever make it true; the close now really happens, so it is the
    //     accepted-state label. What stops it being a fabricated outcome is no
    //     longer the sidecar but WHEN the screen prints it: only after a drain
    //     reported the write synced. That is pinned in pm_close_screen_test.dart —
    //     'the prototype success view never appears' proves loading a signed work
    //     order does NOT print it, and 'a DEFERRED drain says pending' proves a
    //     queued write does not either.
    //   * 'ลงนาม' — it was forbidden as an INSTRUCTION on an inert pad. The pad
    //     captures for real now, and the word survives here only inside
    //     pm.closedNote's 'ลูกค้าลงนามรับงาน' ("the customer signed for the work"),
    //     which is a statement about stored data rather than an invitation. Note
    //     what is still NOT used: pm.signHere ('ลงนาม ✓'), whose ✓ asserts a
    //     COMPLETED signature and would claim an empty pad was already signed.
    //
    // NOT forbidden here either: the bare word 'ปิดงาน'. The CTA legitimately
    // carries it (pm.closeWithSignBtn) as the name of the capability it now has.
    final JuneflowI18n i18n = await JuneflowI18n.load(
      bundle: rootBundle,
      lang: 'th',
    );
    final ScreenStrings s = await ScreenStrings.load(
      'pm_close',
      bundle: rootBundle,
    );
    for (final String name in s.names) {
      // Resolved exactly the way the screen resolves that slot.
      final String rendered = _dictFields.contains(name)
          ? i18n.t(s[name])
          : i18n.tp(s[name]);
      // ONE excusal, and it is a substring collision rather than a loophole: the
      // failure label admin.common.actionFailedToast reads 'ทำรายการไม่สำเร็จ' —
      // "the action did NOT succeed" — which literally contains 'สำเร็จ'. The
      // NEGATED form is the opposite of the claim being guarded, so it is removed
      // before the scan. The bare word is still forbidden everywhere else, so the
      // prototype's success heading cannot slip back in.
      final String scanned = rendered.replaceAll('ไม่สำเร็จ', '');
      for (final String claim in <String>[
        'สำเร็จ', // "succeeded"
        'ใบรับรอง', // "certificate"
        'LINE',
        'ส่งรายงาน', // "send report" — the LINE promise, and pm.toastClosed's tail
        'ลงนาม ✓', // pm.signHere — the tick asserts an ALREADY-completed signature
      ]) {
        expect(
          scanned,
          isNot(contains(claim)),
          reason: '"$name" (${s[name]}) renders "$claim" — nothing backs it',
        );
      }
    }
  });
}
