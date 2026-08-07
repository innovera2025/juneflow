// Zero-mint gate for the st-receive sidecar.
//
// The whole i18n position of this slice is one claim: EVERY key the screen
// renders already exists in the sacred docs/extract/i18n-full.json, so the port
// spends none of the sacred round that BLOCKERS.md B-266 still has to size. That
// claim is worth exactly as much as the test that enforces it — otherwise a later
// edit could quietly introduce a key that resolves to its own id on screen (the
// dict layer returns the key itself when it is missing, so a typo or an unminted
// key does NOT throw; it renders as `gr.create.colOrdered` to the storekeeper and
// nothing fails).
//
// This runs against the REAL bundled asset (the verbatim copy of the sacred
// source), not a fixture, and checks each key in the layer it is actually read
// from — dict ids via t(), phrase keys via tp().
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Sidecar fields read with `t()` — the value is a DICT stable id.
const Set<String> _dictFields = <String>{
  'colOrdered',
  'colReceived',
  'confirm',
  'queued',
  'failed',
};

/// Sidecar fields read with `tp()` — the value IS the Thai phrase (phrases layer).
const Set<String> _phraseFields = <String>{'title', 'deliveryNote'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<Map<String, dynamic>> asset() async =>
      jsonDecode(await rootBundle.loadString(kI18nAssetPath))
          as Map<String, dynamic>;

  test('the sidecar declares exactly the fields the screen reads', () async {
    final ScreenStrings s = await ScreenStrings.load('st_receive');
    // Every declared field is accounted for by one of the two layers above, so a
    // newly added key cannot slip past this file's coverage unnoticed.
    expect(s.names.toSet(), <String>{..._dictFields, ..._phraseFields});
  });

  test('ZERO-MINT: every dict id already exists in the sacred source', () async {
    final ScreenStrings s = await ScreenStrings.load('st_receive');
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

  test(
    'ZERO-MINT: every phrase key already exists in the sacred source',
    () async {
      final ScreenStrings s = await ScreenStrings.load('st_receive');
      final Map<String, dynamic> phrases =
          (await asset())['phrases'] as Map<String, dynamic>;

      for (final String field in _phraseFields) {
        final String key = s[field];
        expect(
          phrases.containsKey(key),
          isTrue,
          reason:
              'sidecar field "$field" -> "$key" is NOT in the phrases layer of '
              'i18n-full.json. In Thai it would still render (the phrase IS the '
              'key), so this would ship silently and only break in en/zh/ar.',
        );
      }
    },
  );

  test(
    'every key resolves to real copy through the runtime, in th AND en',
    () async {
      final ScreenStrings s = await ScreenStrings.load('st_receive');
      final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);

      for (final String field in _dictFields) {
        final String key = s[field];
        // A dict miss returns the key itself — assert the resolved copy differs
        // from the id, which is the observable signature of an unminted key.
        expect(
          i18n.t(key, 'th'),
          isNot(key),
          reason: 'unresolved dict key: $key',
        );
        expect(i18n.t(key, 'en'), isNotEmpty, reason: 'empty en for: $key');
      }
      // The phrases layer returns the key verbatim in Thai by design, so the
      // meaningful check is that a NON-Thai language finds an entry at all.
      for (final String field in _phraseFields) {
        expect(i18n.tp(s[field], 'en'), isNotEmpty);
      }
    },
  );

  test(
    'the two words with no honest key are NOT smuggled into the sidecar',
    () async {
      final ScreenStrings s = await ScreenStrings.load('st_receive');
      final Iterable<String> values = s.names.map((String k) => s[k]);
      // `ขาด` resolves byte-exact to labor.att.optAbsent ("absent") and
      // inv.status.out ("out of stock"): both would read correctly in Thai today
      // and WRONGLY once en/zh/ar are filled. The screen shows a signed number
      // instead, and these two stay on the mint list.
      expect(values, isNot(contains('labor.att.optAbsent')));
      expect(values, isNot(contains('inv.status.out')));
      // The savedToast is the other tempting reuse — it asserts "stock updated",
      // which POST /gr does not do (B-266).
      expect(values, isNot(contains('gr.create.savedToast')));
    },
  );
}
