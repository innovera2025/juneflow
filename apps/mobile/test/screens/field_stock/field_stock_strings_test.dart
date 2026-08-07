// Zero-mint gate for the field-stock sidecar.
//
// The whole i18n position of this slice is one claim: EVERY key the screen renders
// already exists in the sacred docs/extract/i18n-full.json, so the port spends none
// of a Wei sacred round. That claim is worth exactly as much as the test that
// enforces it — otherwise a later edit could quietly introduce a key that resolves
// to its own id on screen (the dict layer returns the KEY ITSELF when it is
// missing, so an unminted key does NOT throw; it renders as `inv.issueAdd.title` to
// the storekeeper and nothing fails).
//
// This runs against the REAL bundled asset (the verbatim copy of the sacred
// source), not a fixture.
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Every sidecar field, all read with `t()` — the value is a DICT stable id.
/// This screen reads no phrases-layer key at all (see the sidecar's _deviations:
/// the one prototype string that IS in the phrases layer is a seeded warehouse
/// name and must come from the wire instead).
const Set<String> _dictFields = <String>{
  'title',
  'itemsTitle',
  'stockLabel',
  'usedFor',
  'confirm',
  'queued',
  'failed',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<Map<String, dynamic>> asset() async =>
      jsonDecode(await rootBundle.loadString(kI18nAssetPath))
          as Map<String, dynamic>;

  test('the sidecar declares exactly the fields the screen reads', () async {
    final ScreenStrings s = await ScreenStrings.load('field_stock');
    expect(s.names.toSet(), _dictFields);
  });

  test('ZERO-MINT: every dict id already exists in the sacred source', () async {
    final ScreenStrings s = await ScreenStrings.load('field_stock');
    final Map<String, dynamic> dict =
        (await asset())['dict'] as Map<String, dynamic>;

    for (final String field in _dictFields) {
      final String key = s[field];
      expect(
        dict.containsKey(key),
        isTrue,
        reason:
            'sidecar field "$field" -> "$key" is NOT in i18n-full.json. It would '
            'render as its own key id on screen. Report it for a mint round '
            'instead of shipping it.',
      );
    }
  });

  test('the two byte-exact reuses really are byte-exact', () async {
    // These two are the only claims of EXACT fidelity this screen makes; the other
    // three copy fields are documented deviations (sidecar _deviations), so pinning
    // the exact pair is what stops a later "tidy-up" from quietly widening them.
    final ScreenStrings s = await ScreenStrings.load('field_stock');
    final Map<String, dynamic> dict =
        (await asset())['dict'] as Map<String, dynamic>;

    String th(String key) =>
        (dict[key] as Map<String, dynamic>)['th'] as String;

    // pototype/mobile-screens.jsx L506 `สต็อก` and L515 `ใช้กับ`.
    expect(th(s['stockLabel']), 'สต็อก');
    expect(th(s['usedFor']), 'ใช้กับ');
  });

  test(
    'the CTA does NOT borrow the web form key that asserts the stock is cut',
    () async {
      // inv.issueAdd.btnSubmit ("save issue + cut stock") is the CTA of the web
      // form for this very endpoint and was the strongest candidate — refused
      // because this screen writes through the OFFLINE QUEUE, where a deferred
      // outcome cuts NO stock. A button may under-claim; it may never assert an
      // outcome that did not happen.
      final ScreenStrings s = await ScreenStrings.load('field_stock');
      expect(s['confirm'], isNot('inv.issueAdd.btnSubmit'));
      expect(s['confirm'], 'common.confirm');
    },
  );

  test('no sidecar value is a Thai literal — keys only', () async {
    // A sidecar carries KEYS, never a translation. Every value here is a dict id,
    // so none may contain a Thai codepoint.
    final ScreenStrings s = await ScreenStrings.load('field_stock');
    final RegExp thai = RegExp(r'[฀-๿]');
    for (final String field in _dictFields) {
      expect(
        thai.hasMatch(s[field]),
        isFalse,
        reason: 'sidecar field "$field" holds Thai text instead of a key id',
      );
    }
  });
}
