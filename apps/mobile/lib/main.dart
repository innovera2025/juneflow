import 'package:flutter/material.dart';

// Juneflow mobile — Phase 0 skeleton (P0-MOB-01). Structure only.
//
// TODO(P4): screens start Phase 4 (PLAN.md §7). Real screens are ported from
// pototype/mobile*.jsx (31 screens — see apps/mobile/docs/screen-map.md once
// P0-MOB-04 lands). Design Fidelity Protocol (PLAN.md §0) applies: never
// design new screens, never "improve" the prototype visuals.
void main() {
  runApp(const JuneflowApp());
}

class JuneflowApp extends StatelessWidget {
  const JuneflowApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Juneflow',
      // TODO(P0-MOB-02): replace this default ThemeData with the ThemeData
      // GENERATED from packages/tokens/src/tokens.json via the gen-flutter-theme
      // pipeline of packages/tokens (fiori theme). The generated file lands in
      // lib/theme/ and must NEVER be hand-edited — change tokens at the source
      // and regenerate (apps/mobile/CLAUDE.md). No hardcoded color/font/spacing
      // values are allowed here.
      theme: ThemeData(useMaterial3: true),
      home: const Scaffold(
        body: Center(
          // TODO(P4): placeholder only — screens start Phase 4.
          child: Text('Juneflow mobile — scaffold (screens start Phase 4)'),
        ),
      ),
    );
  }
}
