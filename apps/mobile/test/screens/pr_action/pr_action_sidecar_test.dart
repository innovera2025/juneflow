// Asset-level test for the PR approve / reject i18n sidecars.
//
// Proves the two real sidecars (assets/i18n/screens/approve_strings.json +
// reject_strings.json) are BUNDLED, parse, carry exactly the keys the screens
// reference, and resolve through the real i18n runtime — for Thai (the default),
// every phrases-layer value IS its own key, so tp() returns it verbatim (the
// B-255 keys render today; en/zh/ar light up once Wei runs the sacred round).
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// The fields each screen reads via `strings[field]` — kept in lockstep with
/// approve_screen.dart / reject_screen.dart.
const List<String> _approveFields = <String>[
  'eyebrow',
  'title',
  'heading',
  'confirmBody',
  'cancel',
];
const List<String> _rejectFields = <String>[
  'eyebrow',
  'title',
  'banner',
  'commonReasons',
  'reason1',
  'reason2',
  'reason3',
  'reason4',
  'reason5',
  'detailLabel',
  'detailPlaceholder',
  'cancel',
  'submit',
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the approve + reject sidecars are bundled and carry the screen keys',
    () async {
      final ScreenStrings approve = await ScreenStrings.load(
        'approve',
        bundle: rootBundle,
      );
      final ScreenStrings reject = await ScreenStrings.load(
        'reject',
        bundle: rootBundle,
      );

      for (final String f in _approveFields) {
        expect(approve[f], isNotEmpty, reason: 'approve sidecar missing "$f"');
      }
      for (final String f in _rejectFields) {
        expect(reject[f], isNotEmpty, reason: 'reject sidecar missing "$f"');
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
      final ScreenStrings approve = await ScreenStrings.load(
        'approve',
        bundle: rootBundle,
      );
      final ScreenStrings reject = await ScreenStrings.load(
        'reject',
        bundle: rootBundle,
      );

      for (final ScreenStrings s in <ScreenStrings>[approve, reject]) {
        for (final String name in s.names) {
          final String key = s[name];
          // phrases layer: for Thai the key IS the text, so tp echoes it non-empty.
          expect(
            i18n.tp(key),
            key,
            reason: 'th tp("$key") should echo the key',
          );
        }
      }
    },
  );

  test(
    'the ฿ symbol the amount uses is a real dict key (subcon.unitBaht)',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);
      // A stable dict key (not a phrase) — resolves for every language.
      expect(i18n.t('subcon.unitBaht'), isNotEmpty);
      expect(i18n.t('subcon.unitBaht'), isNot('subcon.unitBaht'));
    },
  );
}
