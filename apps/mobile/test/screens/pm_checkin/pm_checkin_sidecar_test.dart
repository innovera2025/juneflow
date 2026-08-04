// Asset-level test for the pm-checkin i18n sidecar.
//
// Proves the real sidecar (assets/i18n/screens/pm_checkin_strings.json) is BUNDLED,
// parses, carries exactly the keys the screen references, and — because every value
// is a DICT stable-id — resolves through the real i18n runtime to actual text. That
// last check is the ZERO-MINT guarantee: a key that resolved to itself would be a
// key missing from docs/extract/i18n-full.json (an un-approved mint), which this
// slice must not introduce.
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// The fields the screen reads via `strings[field]` — kept in lockstep with
/// pm_checkin_screen.dart.
const List<String> _fields = <String>[
  'title',
  'serviceZone',
  'sla',
  'contractRef',
  'gpsLabel',
  'checkinBtn',
  'successAt',
  'queued',
  'failed',
  'checklistNext',
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the pm_checkin sidecar is bundled and carries the screen keys',
    () async {
      final ScreenStrings s = await ScreenStrings.load(
        'pm_checkin',
        bundle: rootBundle,
      );
      for (final String f in _fields) {
        expect(s[f], isNotEmpty, reason: 'pm_checkin sidecar missing "$f"');
      }
    },
  );

  test(
    'every sidecar value is a real dict key (zero-mint — resolves to text)',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(
        bundle: rootBundle,
        lang: 'th',
      );
      final ScreenStrings s = await ScreenStrings.load(
        'pm_checkin',
        bundle: rootBundle,
      );
      for (final String name in s.names) {
        final String key = s[name];
        // t() returns the key verbatim ONLY when it is missing from the dict; a real
        // key resolves to its Thai text, which differs from the ASCII stable-id.
        expect(
          i18n.t(key),
          isNot(key),
          reason:
              't("$key") must resolve — the key must exist in i18n-full.json',
        );
      }
    },
  );
}
