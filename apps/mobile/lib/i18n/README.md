# i18n (runtime) — MOB-I18N-01

Key-based translation for `apps/mobile`. Every string a user reads comes from the
**sacred** `docs/extract/i18n-full.json` and nowhere else (PLAN.md §0 rule 2).
Nothing here translates, re-words, or invents text; a UI string with no entry in
that file goes to `BLOCKERS.md` and the screen waits.

This is the text half of the same rule `lib/theme/` enforces for style: values come
from a generated source, never from literals typed into a screen.

## Layers (docs/extract/I18N-KEYS.md §2)

| call | layer | key shape |
|---|---|---|
| `t('common.cancel')` | `dict` | stable id → `{th,en,zh,ar}` |
| `tn(<Thai menu label>)` | `nav_i18n` | **the Thai label IS the key** |
| `tp(<Thai phrase>)` | `phrases` | **the Thai phrase IS the key** |
| `tpat(<Thai sentence>)` | `phrase_patterns` | regex + per-language template, for sentences carrying runtime numbers |

Fallback is `requested → (base language) → en → th`, so `zh-TW` tries its own
entry first (19 nav keys have one), then `zh`, then `en`, then `th`.

## Usage

```dart
import 'package:juneflow_mobile/i18n/i18n.dart';

final i18n = await JuneflowI18n.load();          // once, at startup
final s    = await ScreenStrings.load('approval_inbox');

Text(i18n.tp(s['title']));                        // key from sidecar, text from file
Directionality(textDirection: i18n.isRTL() ? TextDirection.rtl : TextDirection.ltr, …)
```

## Why the keys live in JSON sidecars

Two of the three layers use the Thai text itself as the key, so using them would
mean typing Thai into `.dart` — exactly the hardcoding rule 2 forbids, and what
`.claude/hooks/i18n-guard.sh` exists to catch. `apps/web` solved this with
`*-strings.json` sidecars (see `apps/web/src/screens/land/land-survey-strings.json`);
`assets/i18n/screens/<screen>_strings.json` is the Flutter equivalent. Copy
`_template_strings.json` to start one.

A sidecar holds **keys only**, never translations, and every key must already
exist in the sacred file — verify before adding, and raise the gap in
`BLOCKERS.md` when it does not.

> Note: the guard resolves paths against `CLAUDE_PROJECT_DIR` (the main checkout),
> so it does **not** fire for edits made inside a `juneflow-wt/*` worktree — which
> is where every lane agent works (PLAN.md §8). Treat the no-Thai-in-`lib/` rule as
> discipline you keep, not as something the hook will catch for you.

## Regenerating the asset

```sh
tool/gen_i18n_asset.sh   # verbatim copy + sha256 verification
```

`assets/i18n/i18n-full.json` is a byte-identical copy of the sacred source (the
script fails if it is not) — the same precedent `packages/i18n/src/i18n-full.json`
sets. Never hand-edit it.

## Open gap

`agents/orch-d-recon/mob-i18n-gap.md`: of the Thai strings in
`pototype/mobile*.jsx`, only a minority resolve to an existing key. The mobile
screens need a Wei-approved mint batch (static keys) plus new `phrase_patterns`
for their number-bearing sentences — the mechanism Wei already ruled in
`BLOCKERS.md` B-017 (ก). `tpat()` reads whatever patterns the file carries, so the
runtime is ready the moment they land; `hasPatternFor()` lets a screen assert a
sentence is covered instead of shipping raw Thai.
