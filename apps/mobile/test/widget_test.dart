// Smoke test for the Phase 0 skeleton (P0-MOB-01).
//
// Screens start Phase 4 (PLAN.md §7); this only asserts the scaffold app
// builds and renders its placeholder. Real screen tests are ported from
// pototype/mobile*.jsx under the Design Fidelity Protocol (PLAN.md §0).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:juneflow_mobile/main.dart';

void main() {
  testWidgets('JuneflowApp renders the scaffold placeholder', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const JuneflowApp());

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(
      find.text('Juneflow mobile — scaffold (screens start Phase 4)'),
      findsOneWidget,
    );
  });
}
