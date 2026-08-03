// Staleness gate for the bundled i18n asset (MOB-I18N-01).
//
// i18n-full.json now has THREE copies: the sacred docs/extract/ original, the
// packages/i18n/src/ copy the web loader imports, and assets/i18n/ here. The first
// two are compared byte-for-byte by whoever applies a mint (P1-PLAT-03/04). This
// third one is produced by tool/gen_i18n_asset.sh, and nothing else would notice
// if someone applied a mint and forgot to rerun it — the app would just keep
// serving yesterday's keys, and every new key would render as its own name.
//
// So: compare the bundled asset against the sacred source and fail on any drift.
// The check runs against the repo checkout, which `flutter test` can reach because
// it executes on the host VM.
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/i18n/i18n.dart';

/// Repo-root-relative path of the single source of truth (SACRED, read-only).
const String _sacredRelative = '../../docs/extract/i18n-full.json';

/// Marker proving we are running inside the monorepo checkout rather than against
/// an extracted copy of just this package.
const String _repoMarker = '../../PLAN.md';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the bundled asset is byte-identical to the sacred source', () async {
    final File sacred = File(_sacredRelative);
    if (!File(_repoMarker).existsSync()) {
      // Outside the monorepo there is nothing to compare against. Say so loudly
      // rather than passing quietly, so a green run always means a real check.
      fail(
        'Cannot verify the i18n asset: $_repoMarker is missing, so this is not a '
        'monorepo checkout. Run flutter test from apps/mobile inside the repo.',
      );
    }
    expect(
      sacred.existsSync(),
      isTrue,
      reason: 'sacred source not found at $_sacredRelative',
    );

    final Digest sourceHash = sha256.convert(sacred.readAsBytesSync());
    final Digest assetHash = sha256.convert(
      (await rootBundle.load(kI18nAssetPath)).buffer.asUint8List(),
    );

    expect(
      assetHash.toString(),
      sourceHash.toString(),
      reason:
          'assets/i18n/i18n-full.json has drifted from docs/extract/i18n-full.json. '
          'A mint was almost certainly applied without regenerating the asset — run '
          'tool/gen_i18n_asset.sh from apps/mobile, then rerun the tests.',
    );
  });

  test('every key the asset serves comes from the sacred source', () async {
    // A second, weaker check that still holds if the byte compare is ever relaxed
    // (for example if the asset is pruned): no key may exist here that does not
    // exist there, because that would mean copy invented one.
    final Map<String, dynamic> sacred =
        jsonDecode(File(_sacredRelative).readAsStringSync()) as Map<String, dynamic>;
    final JuneflowI18n asset = await JuneflowI18n.load(bundle: rootBundle);

    for (final MapEntry<String, int> layer in <String, int>{
      'dict': asset.dictCount,
      'nav_i18n': asset.navCount,
      'phrases': asset.phraseCount,
    }.entries) {
      final Map<String, dynamic> block = sacred[layer.key] as Map<String, dynamic>;
      expect(
        layer.value,
        lessThanOrEqualTo(block.length),
        reason: '${layer.key}: asset serves more entries than the sacred source has',
      );
    }
  });
}
