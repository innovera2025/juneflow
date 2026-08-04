// Asset-level test for the st-grlist i18n sidecar.
//
// Proves the real sidecar (assets/i18n/screens/st_grlist_strings.json) is
// BUNDLED, parses, carries exactly the keys the screen references, and resolves
// through the real i18n runtime — for Thai (the default), every phrases-layer
// value IS its own key, so tp() returns it verbatim (the B-257 keys render today;
// en/zh/ar light up once Wei runs the sacred round).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// The fields the screen reads via `strings[field]` — kept in lockstep with
/// st_grlist_screen.dart.
const List<String> _fields = <String>['eyebrow', 'title', 'ctaReceive'];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the st_grlist sidecar is bundled and carries the screen keys',
    () async {
      final ScreenStrings s = await ScreenStrings.load(
        'st_grlist',
        bundle: rootBundle,
      );
      for (final String f in _fields) {
        expect(s[f], isNotEmpty, reason: 'st_grlist sidecar missing "$f"');
      }
    },
  );

  test(
    'every sidecar key resolves through the real i18n for Thai (renders today)',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'st_grlist',
        bundle: rootBundle,
      );
      for (final String name in s.names) {
        final String key = s[name];
        // phrases layer: for Thai the key IS the text, so tp echoes it non-empty.
        expect(i18n.tp(key), key, reason: 'th tp("$key") should echo the key');
      }
    },
  );
}
