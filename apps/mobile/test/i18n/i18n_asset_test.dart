// Asset gate for the mobile i18n runtime (MOB-I18N-01).
//
// The other i18n tests exercise the logic against a small fixture. This one
// exercises the REAL bundled asset — the verbatim copy of the sacred
// docs/extract/i18n-full.json produced by tool/gen_i18n_asset.sh — so a bad or
// missing regeneration fails the gate instead of surfacing as blank screens.
//
// Assertions are shape-and-presence, deliberately not exact counts: Wei minting
// new keys must not turn this test red (mobile has an open mint request for the
// 26 screens — agents/orch-d-recon/mob-i18n-gap.md).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the bundled asset parses and carries all four blocks', () async {
    final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);

    expect(i18n.dictCount, greaterThan(0), reason: 'dict layer missing');
    expect(i18n.navCount, greaterThan(0), reason: 'nav_i18n layer missing');
    expect(i18n.phraseCount, greaterThan(0), reason: 'phrases layer missing');
    expect(i18n.patternCount, greaterThan(0), reason: 'phrase_patterns block missing');
  });

  test('declares the four prototype languages, with ar as the only rtl one', () async {
    final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);

    expect(
      i18n.langs.map((LangDef l) => l.code).toSet(),
      <String>{'th', 'zh', 'en', 'ar'},
    );
    expect(i18n.isRTL('ar'), isTrue);
    expect(i18n.langs.where((LangDef l) => l.dir == 'rtl').map((LangDef l) => l.code), <String>['ar']);
  });

  test('real keys resolve across th/en/zh/ar', () async {
    final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);

    // dict layer — stable key, all four languages present (I18N-KEYS.md §2).
    expect(i18n.t('common.cancel', 'en'), 'Cancel');
    expect(i18n.t('common.cancel', 'th'), 'ยกเลิก');
    expect(i18n.t('common.cancel', 'zh'), '取消');
    expect(i18n.t('common.cancel', 'ar'), 'إلغاء');

    // phrases layer — the Thai phrase is the key; "th" returns it unchanged.
    expect(i18n.tp('ทั้งหมด', 'th'), 'ทั้งหมด');
    expect(i18n.tp('ทั้งหมด', 'en'), 'All');

    // nav layer — the Thai menu label is the key.
    expect(i18n.tn('งานหลัก', 'en'), 'Main');
    expect(i18n.tn('งานหลัก', 'th'), 'งานหลัก');
  });

  test('the shipped phrase_patterns still substitute', () async {
    final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);

    expect(i18n.tpat('แสดง 10 จาก 240 รายการ', 'en'), 'Showing 10 of 240');
    expect(i18n.tpat('กรอง · 7', 'en'), 'Filter · 7');
  });

  test('the template sidecar declares no keys — it is documentation only', () async {
    final ScreenStrings template = await ScreenStrings.load('_template', bundle: rootBundle);
    expect(template.names, isEmpty);
  });
}
