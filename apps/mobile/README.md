# juneflow_mobile

Juneflow Construction ERP — Flutter mobile app.

**Phase 0 = scaffold skeleton only.** Real screens start Phase 4 (PLAN.md §7)
and are ported 1:1 from `pototype/mobile*.jsx` under the Design Fidelity
Protocol (PLAN.md §0). See `apps/mobile/CLAUDE.md` for zone rules:

- Theme (`lib/theme/`) is **generated** from `packages/tokens` (P0-MOB-02) — never hand-edit.
- API client is **generated** from `packages/contracts/openapi.yaml` (P0-MOB-03) — never hand-write models.
- Offline-first (drift/SQLite + sync queue) lands in P0-MOB-05.

Common commands (run from `apps/mobile/`):

```
flutter pub get
flutter analyze
flutter test
flutter build web   # Android/iOS builds require their platform SDKs
```
