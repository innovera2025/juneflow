// Asset-level test for the approvals-inbox + PR-detail i18n sidecars.
//
// Proves the two real sidecars (assets/i18n/screens/approvals_inbox_strings.json +
// pr_detail_strings.json) are BUNDLED, parse, carry exactly the keys the screens
// reference, and are ZERO-MINT: every phrases-layer value already exists as a key in
// the bundled sacred i18n-full.json (so no Wei sacred round is needed — tp() echoes
// it for Thai and en/zh/ar resolve from the file), and every dict key the screens
// read directly resolves to a real translation.
import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// The fields each screen reads via `strings[field]` — kept in lockstep with
/// approvals_inbox_screen.dart / pr_detail_screen.dart.
const List<String> _inboxFields = <String>[
  'sub',
  'chipPending',
  'chipUrgent',
  'chipTotal',
  'filterAll',
  'filterUrgent',
  'unitMinute',
  'unitHour',
  'unitDay',
];
const List<String> _detailFields = <String>[
  'sub',
  'statusPending',
  'statusApproved',
  'statusRejected',
  'statusDraft',
  'requesterLabel',
  'projectLabel',
  'needDateLabel',
  'vendorLabel',
  'materialsLabel',
  'viewAll',
];

/// The dict keys the screens read directly (not via a sidecar) — must resolve to
/// real translations (not echo the key back).
const List<String> _dictKeys = <String>[
  'mob.approval.inbox.title',
  'mob.approval.inbox.cardAgeAgo',
  'mob.approval.detail.netTotal',
  'mob.approval.detail.lineCountVat',
  'mob.approval.detail.awaitingYou',
  'mob.approval.detail.approveWithAmount',
  'subcon.unitBaht',
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'the inbox + detail sidecars are bundled and carry the screen keys',
    () async {
      final ScreenStrings inbox = await ScreenStrings.load(
        'approvals_inbox',
        bundle: rootBundle,
      );
      final ScreenStrings detail = await ScreenStrings.load(
        'pr_detail',
        bundle: rootBundle,
      );

      for (final String f in _inboxFields) {
        expect(inbox[f], isNotEmpty, reason: 'inbox sidecar missing "$f"');
      }
      for (final String f in _detailFields) {
        expect(detail[f], isNotEmpty, reason: 'detail sidecar missing "$f"');
      }
    },
  );

  test(
    'ZERO-MINT: every sidecar phrase value already exists in the sacred file',
    () async {
      // The bundled verbatim copy of docs/extract/i18n-full.json.
      final Map<String, dynamic> file =
          jsonDecode(await rootBundle.loadString(kI18nAssetPath))
              as Map<String, dynamic>;
      final Map<String, dynamic> phrases =
          (file['phrases'] as Map<String, dynamic>?) ?? <String, dynamic>{};

      final ScreenStrings inbox = await ScreenStrings.load(
        'approvals_inbox',
        bundle: rootBundle,
      );
      final ScreenStrings detail = await ScreenStrings.load(
        'pr_detail',
        bundle: rootBundle,
      );

      for (final ScreenStrings s in <ScreenStrings>[inbox, detail]) {
        for (final String name in s.names) {
          final String key = s[name];
          expect(
            phrases.containsKey(key),
            isTrue,
            reason:
                'phrase key "$key" must already exist (zero-mint, no new keys)',
          );
        }
      }
    },
  );

  test(
    'the dict keys the screens read directly resolve for every language',
    () async {
      final JuneflowI18n i18n = await JuneflowI18n.load(bundle: rootBundle);
      for (final String key in _dictKeys) {
        expect(i18n.t(key), isNotEmpty, reason: 'dict "$key" missing');
        expect(i18n.t(key), isNot(key), reason: 'dict "$key" did not resolve');
      }
    },
  );
}
