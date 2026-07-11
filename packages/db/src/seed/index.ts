// @juneflow/db - seed entrypoint (STUB).
//
// TODO(P0-BE-10): implement seed from docs/extract/MOCK-DATA.md, section
// "สรุปสำหรับทำ seed data" (until P0-BE-02 is done, read
// juneflow-extract/MOCK-DATA.md). Record counts per entity in that section are
// the expected fixture - QA asserts them 1:1 (P0-QA-06).
//
// Decision mappings ruled by Wei (PLAN.md Appendix C) that MUST be applied at
// seed time:
//   - C3: WorkPeriod mock states map to the flows/dictionary state machine:
//         requested -> delivered, accepted -> passed
//   - C6: VENDOR_SEED is declared in 2 files - use the master-party.jsx set
//         (the real master that other modules reference)
//   - C9: JV mock has no real lines - generate balanced lines from mock totals
//         so that sum(DR) == sum(CR), shape per dictionary:
//         lines[{account_id, dr, cr, cc_id, project_id}]
//
// Additional hard rules (PLAN.md section 0 rule 3 / section 6):
//   - normalize mock name-text FKs into real *_id FKs
//   - seed must PERSIST - never reseed on every reload (prototype mock mechanism)
//   - C10: NAV badges are counts from real queries - never hardcode badge
//     numbers into seed/config
//
// Any conflict not covered by Appendix C -> BLOCKERS.md. Never guess.

async function seed(): Promise<void> {
  throw new Error("NOT_IMPLEMENTED: seed from MOCK-DATA.md (P0-BE-10)");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
