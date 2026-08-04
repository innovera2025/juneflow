// Unit tests for the mobile Sales CRM pure derivations (route sales-crm).
//
// No Flutter, no network — these lock the honest wire → display derivations:
// warmth (real SA-1 column + the hot-boolean backfill fallback), stage bucketing
// (unknown stage dropped, server order preserved), the real per-stage counts, and
// the blank-column → null projections. Thai literals are legitimate here
// (*_test.dart is exempt from the i18n-guard).
import 'package:flutter_test/flutter_test.dart';
import 'package:juneflow_mobile/screens/sales_crm/sales_crm_agg.dart';

void main() {
  group('warmthOf', () {
    test('prefers the real SA-1 warmth string (hot/warm/cold)', () {
      expect(warmthOf(<String, Object?>{'warmth': 'hot'}), LeadWarmth.hot);
      expect(warmthOf(<String, Object?>{'warmth': 'warm'}), LeadWarmth.warm);
      expect(warmthOf(<String, Object?>{'warmth': 'cold'}), LeadWarmth.cold);
    });

    test('falls back to the hot boolean via migration 0042 backfill', () {
      // true -> hot, false -> warm (exactly the migration's own backfill rule).
      expect(warmthOf(<String, Object?>{'hot': true}), LeadWarmth.hot);
      expect(warmthOf(<String, Object?>{'hot': false}), LeadWarmth.warm);
    });

    test('warmth string wins over the hot boolean', () {
      expect(
        warmthOf(<String, Object?>{'warmth': 'cold', 'hot': true}),
        LeadWarmth.cold,
      );
    });

    test('neither present -> unknown (the view shows no badge)', () {
      expect(warmthOf(<String, Object?>{}), LeadWarmth.unknown);
      expect(warmthOf(<String, Object?>{'warmth': ''}), LeadWarmth.unknown);
      expect(
        warmthOf(<String, Object?>{'warmth': 'lukewarm'}),
        LeadWarmth.unknown,
      );
    });
  });

  group('leadStageOf', () {
    test('maps the 5 known funnel stages', () {
      expect(leadStageOf('lead'), LeadStage.lead);
      expect(leadStageOf('visit'), LeadStage.visit);
      expect(leadStageOf('quote'), LeadStage.quote);
      expect(leadStageOf('booking'), LeadStage.booking);
      expect(leadStageOf('contract'), LeadStage.contract);
    });

    test('an unknown / mock-only stage value -> null (never guessed)', () {
      // The mock's "โอน"/transfer chip has no server stage — it must not resolve.
      expect(leadStageOf('transfer'), isNull);
      expect(leadStageOf('โอน'), isNull);
      expect(leadStageOf(''), isNull);
    });
  });

  group('parseLead', () {
    test('projects the real columns; blank ones become null', () {
      final LeadRow r = parseLead(<String, Object?>{
        'id': 'L1',
        'name': 'คุณวีระชัย ใจกล้า',
        'interest': 'Block B · 3 ห้องนอน',
        'note': 'พร้อมเงินสด',
        'stage': 'lead',
        'warmth': 'hot',
      });
      expect(r.id, 'L1');
      expect(r.name, 'คุณวีระชัย ใจกล้า');
      expect(r.interest, 'Block B · 3 ห้องนอน');
      expect(r.note, 'พร้อมเงินสด');
      expect(r.stage, LeadStage.lead);
      expect(r.warmth, LeadWarmth.hot);
    });

    test('a bare row em-dashes to null fields (never fabricated)', () {
      final LeadRow r = parseLead(<String, Object?>{
        'id': 'x',
        'stage': 'visit',
      });
      expect(r.name, isNull);
      expect(r.interest, isNull);
      expect(r.note, isNull);
      expect(r.stage, LeadStage.visit);
      expect(r.warmth, LeadWarmth.unknown);
    });
  });

  group('leadsInStage / stageCount', () {
    final List<LeadRow> rows = parseLeads(<LeadEnt>[
      <String, Object?>{'id': 'a', 'stage': 'lead', 'name': 'A'},
      <String, Object?>{'id': 'b', 'stage': 'visit', 'name': 'B'},
      <String, Object?>{'id': 'c', 'stage': 'lead', 'name': 'C'},
      <String, Object?>{'id': 'd', 'stage': 'transfer', 'name': 'D'}, // unknown
    ]);

    test('buckets by real stage, preserving server order', () {
      final List<LeadRow> leadStage = leadsInStage(rows, LeadStage.lead);
      expect(leadStage.map((LeadRow r) => r.id).toList(), <String>['a', 'c']);
      expect(leadsInStage(rows, LeadStage.visit).single.id, 'b');
    });

    test('an unknown-stage row is in no column', () {
      for (final LeadStage s in kLeadStages) {
        expect(
          leadsInStage(rows, s).any((LeadRow r) => r.id == 'd'),
          isFalse,
          reason: 'unknown-stage row leaked into $s',
        );
      }
    });

    test('stageCount is the real per-stage count (not a mock literal)', () {
      expect(stageCount(rows, LeadStage.lead), 2);
      expect(stageCount(rows, LeadStage.visit), 1);
      expect(stageCount(rows, LeadStage.quote), 0);
    });
  });
}
