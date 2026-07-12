# API client (generated) — P0-MOB-03

`generated/` holds the Dart API client **generated** from the single source of the
API contract: `packages/contracts/openapi.yaml` (SACRED — changes go through Wei).
Hand-written models/clients are forbidden (root `CLAUDE.md`, PLAN.md §5).

- **Stack:** `retrofit` (on `dio`) clients + `json_serializable` models. One
  `*Api` class per OpenAPI tag, aggregated by `JuneflowApiClient`.
- **Entry point:** `import 'package:juneflow_mobile/api/generated/export.dart';`
  then `JuneflowApiClient(dio, baseUrl: '.../api/v1')`.

## Regenerate

```sh
tool/gen_api_client.sh      # normalize contract → swagger_parser → build_runner
```

Never hand-edit anything under `generated/` (every file says so) — change the
contract (via Wei) and regenerate.

## Why a normalize step (`tool/normalize_openapi.py`)

The host has no JRE, so openapi-generator (Java) is unusable; we use the pure-Dart
`swagger_parser`. Two semantics-preserving rewrites let it parse this contract
without touching the sacred file (it reads a derived copy in `build/`):

1. **Path-level `parameters` inlined** into each operation — swagger_parser 1.44.0
   crashes on the path-level form (valid OpenAPI 3.1).
2. **Free-form objects → empty classes** — opaque schemas like `Entity` (which
   declare no fields yet) would otherwise render as `typedef = dynamic`, which
   retrofit_generator can neither list-wrap nor call `.fromJson` on. They become
   empty `@JsonSerializable` classes; regeneration fills in fields once the
   data-dictionary schema tasks add them to the contract.

Prereqs (dev host only — CI consumes the committed output): `python3` + `pyyaml`,
Flutter/Dart, and `dart pub global activate swagger_parser`.
