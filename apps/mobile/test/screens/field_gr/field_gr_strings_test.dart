// Zero-mint gate for the field-gr sidecar.
//
// The whole i18n position of this slice is one claim: EVERY key the screen
// renders already exists in the sacred docs/extract/i18n-full.json, so the port
// spends none of a Wei sacred round. That claim is worth exactly as much as the
// test that enforces it — otherwise a later edit could quietly introduce a key
// that resolves to its own id on screen (the dict layer returns the key itself
// when it is missing, so an unminted key does NOT throw; it renders as
// `gr.list.receivedItems` to the site foreman and nothing fails).
//
// This runs against the REAL bundled asset (the verbatim copy of the sacred
// source), not a fixture, and checks each key in the layer it is read from.
//
// Thai literals are legitimate here: *_test.dart is exempt from the i18n-guard.
import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Sidecar fields read with `t()` — the value is a DICT stable id.
const Set<String> _dictFields = <String>{'title', 'receivedItems'};

/// Sidecar fields read with `tp()` — the value IS the Thai phrase.
const Set<String> _phraseFields = <String>{'vendorLabel'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<Map<String, dynamic>> asset() async =>
      jsonDecode(await rootBundle.loadString(kI18nAssetPath))
          as Map<String, dynamic>;

  test('the sidecar declares exactly the fields the screen reads', () async {
    final ScreenStrings s = await ScreenStrings.load('field_gr');
    expect(s.names.toSet(), <String>{..._dictFields, ..._phraseFields});
  });

  test('ZERO-MINT: every dict id already exists in the sacred source', () async {
    final ScreenStrings s = await ScreenStrings.load('field_gr');
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
      final ScreenStrings s = await ScreenStrings.load('field_gr');
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

  test('the two dict values are byte-exact with the prototype', () async {
    final ScreenStrings s = await ScreenStrings.load('field_gr');
    final Map<String, dynamic> dict =
        (await asset())['dict'] as Map<String, dynamic>;
    String th(String key) =>
        (dict[key] as Map<String, dynamic>)['th'] as String;

    // mobile-screens.jsx L367 title, L375 section title — grepped, not retyped.
    expect(th(s['title']), 'รับสินค้า');
    expect(th(s['receivedItems']), 'รายการที่รับ');
  });

  test(
    'every key resolves to real copy through the runtime, in th AND en',
    () async {
      final ScreenStrings s = await ScreenStrings.load('field_gr');
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

  test('no near-miss key is smuggled into the sidecar', () async {
    final ScreenStrings s = await ScreenStrings.load('field_gr');
    final Iterable<String> values = s.names.map((String k) => s[k]);

    // The shortfall noun resolves byte-exact to labor.att.optAbsent ("absent
    // from work") and inv.status.out ("out of stock"): both read correctly in
    // Thai today and WRONGLY once en/zh/ar are filled. st-receive refused the
    // same two for the same reason; the screen shows a signed number instead.
    expect(values, isNot(contains('labor.att.optAbsent')));
    expect(values, isNot(contains('inv.status.out')));
    // Right sentence, but it HARDCODES one unit inside its own value, so it
    // would print a bar-unit shortfall on a bag line.
    expect(values, isNot(contains('gr.list.shortReceived')));
    // Byte-exact for the reject HALF of the footer button, dropping the return
    // half — the half that names what POST /gr/:id/return does.
    expect(values, isNot(contains('common.reject')));
    // Right words for that same button, but a KPI-tile id: a translator would
    // fill en/zh/ar with the noun "Returns".
    expect(values, isNot(contains('gr.list.kpiReturns')));
    // Merely CONTAIN the prototype's words inside a different string.
    expect(values, isNot(contains('gr.create.partialCheckbox')));
    expect(values, isNot(contains('gr.create.attachBtn')));
    // Over-claims L373's bare "delivery note" as "delivery note NUMBER" — and
    // there is no column behind either wording.
    expect(values, isNot(contains('gr.create.deliveryNoteNo')));
    // Asserts "stock updated", which POST /gr does not do (B-266).
    expect(values, isNot(contains('gr.create.savedToast')));
  });
}
