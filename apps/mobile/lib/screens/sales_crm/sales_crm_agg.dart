// Pure parse + honest derivations for the mobile Sales CRM screen (route
// `sales-crm`, pototype/mobile-screens.jsx MSalesCRM L722-771). money = NONE.
//
// The prototype is a MOCK: MSalesCRM hardcodes a 5-chip stage-count strip (with
// literal per-stage counts 12 / 5 / 3 / 2 / 1) and a fixed 3-lead list, each lead
// denormalised into rich display (a customer name, an interest line, a hot/warm
// warmth, a contact phone, a free-text note, per-lead call/LINE/visit buttons).
// Per §0 rule 3 (strip mock mechanics) NONE of that mock data is reproduced. This
// module parses the REAL GET /sales/leads rows (apps/api/src/routes/land-sales.ts
// leadWire) and derives ONLY what the real wire columns support. No Flutter, no
// i18n, no Dio here — every derivation stays unit-testable.
//
// This mirrors apps/web/src/screens/sales/sales-crm-rows.ts, the already-merged web
// port of the SAME endpoint. The real wire row is
//   { id, name, phone, source, interest, stage, hot, warmth, last_contact_at,
//     note, owner_user_id, days, created_at }   (ordered newest-first server-side).
// Honest notes:
//   - stage is the 5-stage funnel enum (lead|visit|quote|booking|contract) — the
//     board axis. The MOBILE prototype's chip labels are the mock's own 5-step
//     funnel (lead / visit / booking / contract / transfer) and do NOT match the
//     server enum: it has no transfer stage and drops the quote stage. The merged
//     web port already
//     resolved this in favour of server truth; this module buckets by the REAL 5
//     stages, never forcing a row into an invented column (an unknown stage value is
//     dropped, never guessed).
//   - warmth is the real SA-1 (migration 0042) 3-state column hot|warm|cold; `hot`
//     is the retained back-compat boolean. warmthOf prefers the real `warmth`
//     string, falling back to the boolean via migration 0042's own backfill rule
//     (true->hot, false->warm); an absent/unrecognised value stays `unknown` (the
//     view shows no badge — never an invented warmth).
//   - the per-stage counts are DERIVED from the real rows (replacing the mock
//     12/5/3/2/1 literals — C10: derive from the real query, never hardcode).
//   - name / interest / note are real columns (the view em-dashes a blank one).
//   - phone / owner_user_id / last_contact_at / days exist on the wire but the
//     MOBILE card layout shows none of them (the prototype card is
//     name/interest/warmth/note + action buttons), so they are intentionally not
//     projected here — never displayed, never fabricated.

/// An opaque contract Entity — GET /sales/leads rows are `{ [k]: unknown }`.
typedef LeadEnt = Map<String, Object?>;

/// Non-empty string at [key], else null.
String? leadStr(LeadEnt e, String key) {
  final Object? v = e[key];
  return v is String && v.isNotEmpty ? v : null;
}

/// The 5 CRM funnel stages, in board order (the server `stage` enum; mirrors
/// sales-crm-rows.ts LEAD_STAGES). The kanban / chip-strip axis.
enum LeadStage { lead, visit, quote, booking, contract }

/// All 5 stages in board order — drives the chip strip.
const List<LeadStage> kLeadStages = <LeadStage>[
  LeadStage.lead,
  LeadStage.visit,
  LeadStage.quote,
  LeadStage.booking,
  LeadStage.contract,
];

/// Map the real `stage` wire value to a [LeadStage], or null when it is not one of
/// the 5 known stages (such a row is dropped from every column — never guessed).
LeadStage? leadStageOf(String raw) {
  switch (raw) {
    case 'lead':
      return LeadStage.lead;
    case 'visit':
      return LeadStage.visit;
    case 'quote':
      return LeadStage.quote;
    case 'booking':
      return LeadStage.booking;
    case 'contract':
      return LeadStage.contract;
    default:
      return null;
  }
}

/// The CRM warmth signal (SA-1, migration 0042). `unknown` is the honest fallback
/// for any absent/unrecognised value — never a guessed warmth.
enum LeadWarmth { hot, warm, cold, unknown }

/// Derive warmth from the real wire: prefer the SA-1 `warmth` string; else fall
/// back to the retained `hot` boolean using migration 0042's own backfill rule
/// (true->hot, false->warm). Anything else -> unknown (the view shows no badge).
LeadWarmth warmthOf(LeadEnt e) {
  switch (leadStr(e, 'warmth')) {
    case 'hot':
      return LeadWarmth.hot;
    case 'warm':
      return LeadWarmth.warm;
    case 'cold':
      return LeadWarmth.cold;
  }
  final Object? hot = e['hot'];
  if (hot == true || hot == 'true' || hot == 1) return LeadWarmth.hot;
  if (hot == false || hot == 'false' || hot == 0) return LeadWarmth.warm;
  return LeadWarmth.unknown;
}

/// One parsed lead (typed projection of the opaque wire row) — only the columns the
/// mobile card actually shows.
class LeadRow {
  const LeadRow({
    required this.id,
    required this.name,
    required this.interest,
    required this.note,
    required this.stage,
    required this.warmth,
  });

  final String id;

  /// Real `name` column, or null when blank (the view renders an em-dash).
  final String? name;

  /// Real `interest` column, or null when blank (em-dash in the view).
  final String? interest;

  /// Real `note` column, or null when blank (the note box is omitted).
  final String? note;

  /// The funnel stage this lead sits in, or null when the wire value is unknown
  /// (an unknown-stage row is bucketed into no column).
  final LeadStage? stage;

  /// Warmth derived from the real wire (drives the badge + left accent).
  final LeadWarmth warmth;
}

/// Parse one opaque Entity row into a typed [LeadRow].
LeadRow parseLead(LeadEnt e) {
  return LeadRow(
    id: leadStr(e, 'id') ?? '',
    name: leadStr(e, 'name'),
    interest: leadStr(e, 'interest'),
    note: leadStr(e, 'note'),
    stage: leadStageOf(leadStr(e, 'stage') ?? ''),
    warmth: warmthOf(e),
  );
}

/// Parse the GET /sales/leads page rows, preserving the server order (it already
/// orders newest-first — land-sales.ts listLeads). No client re-sort is invented.
List<LeadRow> parseLeads(List<LeadEnt> rows) => rows.map(parseLead).toList();

/// The leads in [stage], in input (server) order. Rows in another stage — and any
/// with an unknown stage — are excluded (never forced into this column).
List<LeadRow> leadsInStage(List<LeadRow> rows, LeadStage stage) =>
    rows.where((LeadRow r) => r.stage == stage).toList();

/// Count of leads in [stage] — the real chip-badge number (replaces the mock
/// per-stage literals).
int stageCount(List<LeadRow> rows, LeadStage stage) =>
    rows.where((LeadRow r) => r.stage == stage).length;
