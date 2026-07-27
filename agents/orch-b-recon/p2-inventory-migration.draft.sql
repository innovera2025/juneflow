-- ============================================================================
-- p2-inventory-migration.draft.sql  —  REFERENCE ONLY (orch-B accelerator draft)
-- ============================================================================
-- Program-2 Operational Core · INVENTORY per-warehouse model · B-141 B2 + B3.
--
-- STATUS
--   Reference draft. NOT placed in packages/db/drizzle/. orch-A owns the real
--   migration: author the Drizzle schema (packages/db/src/schema/extensions.ts,
--   next to warehouses/inventoryItems/stockTransfers/materialIssues) then run
--   `drizzle-kit generate` so the .sql is machine-emitted. This file exists so
--   orch-A + orch-B gate against ONE shared table/column/FK op-set.
--
-- AUTHORIZATION
--   Sacred inventory openapi + schema round is Wei-authorized under
--   SACRED_OVERRIDE=wei-approved:B-141 (BLOCKERS.md:163). orch-A files+implements;
--   orch-B verifies additive-only + stock-ledger atomicity.
--
-- TARGET MIGRATION NUMBER  — orch-A to CLAIM (DO NOT hard-assign here)
--   channel.md:2812 — orch-A CLAIMed 0040 for the labor-write slice (B-140) and
--   noted "Inventory tables (stock_ledger/transfer_line/issue_line) = separate
--   migration next chunk." Next free number is likely 0041, but orch-A claims it
--   in channel.md at author time. This draft is number-agnostic on purpose.
--
-- SOURCES READ (cite before change — root CLAUDE.md §Design-Fidelity)
--   • packages/db/drizzle/0005_overconfident_jetstream.sql — the 4 inventory
--     tables already migrated: warehouse, inventory_item, stock_transfer,
--     material_issue. This draft ADDS the per-warehouse movement layer on top.
--   • packages/db/src/schema/extensions.ts:85-194 — Drizzle style for those 4
--     tables (uuid PK defaultRandom · company_id cascade · currency_code default
--     THB · qty numeric(18,4) · <table>_company_idx).
--   • packages/db/src/schema/boq.ts:513-542 + drizzle/0018_gr_item.sql —
--     child-line-table precedent (gr_item): parent FK cascade, NO own company_id
--     (tenant-scoped transitively via parent), per-line index on parent + lookup.
--   • pototype/inventory.jsx:48 (KPI "มูลค่าคงคลัง … ราคามาตรฐาน × stock"),
--     :206-210 (TRANSFERS), :262-266 (ISSUES), :529-568 (transfer form line =
--     code/name/unit/qty/price · total=Σ qty×price), :596-644 (issue form line +
--     over-stock danger guard) — confirms standard-cost valuation and the
--     line = {item, qty} shape with money DERIVED from qty × item.price.
--   • BLOCKERS.md:163 — B-141 rulings (B1 standard-cost/no-FIFO · B2 stock_ledger
--     per item×warehouse · B3 line tables · B4 transfer atomic dual-wh B-097 txn ·
--     B5 issue posts cost-to-BOQ server-money · B6 negative-stock 409).
--
-- INVARIANTS HELD (root CLAUDE.md §กฎเหล็ก)
--   • Every table/row is tenant-scoped by company_id — stock_ledger carries it
--     directly (first-class fact table); transfer_line/issue_line inherit it
--     transitively through their parent header's company_id via ON DELETE cascade
--     (gr_item/pr_item/bid_comparison_line precedent — child lines do not
--     denormalize company_id in this codebase).
--   • Money is SERVER-computed, never client, standard-cost (B1): line value =
--     qty × inventory_item.price; per-warehouse valuation = price × balance.
--     No money column is stored on these three tables → no client-authored money
--     can enter. currency_code lives on the OWNING money row (stock_transfer.value,
--     material_issue.value, inventory_item.price — all already carry it in 0005).
--     If orch-A later freezes a cost snapshot on a line, that new column IS money
--     and MUST carry currency_code (default 'THB') — see NOTE at issue_line.
--   • Time stored UTC always → timestamp with time zone everywhere.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) stock_ledger  —  B2: per-item × per-warehouse movement ledger
-- ----------------------------------------------------------------------------
-- The existing inventory_item.stock (0005) is a single scalar per item — it
-- cannot express a per-warehouse balance. This append-only ledger replaces that
-- scalar as the source of truth: on-hand(item, warehouse) = SUM(qty) over rows.
--   • qty is SIGNED: positive = receipt/transfer-in, negative = issue/transfer-out.
--   • Every stock-moving op writes ledger rows inside its own transaction:
--       - transfer approve (B4) writes TWO rows atomically — (-qty @ from_wh) and
--         (+qty @ to_wh) — in the B-097 tx-door so a half-move can never persist.
--       - issue post (B5) writes one (-qty @ from_wh) row.
--       - GR/receipt + manual adjustment write (+qty) rows.
--   • Negative-stock guard (B6): before writing a (-qty) row the handler asserts
--     SUM(qty) + delta >= 0 for that (item, warehouse); else HTTP 409. Mirrors the
--     prototype's over-stock danger state (inventory.jsx:634-644).
--   • APPEND-ONLY / immutable: no updated_at by design — corrections are posted as
--     reversing (+/-) entries, never in-place edits (bank_statement_line reverse
--     precedent, 0028 / B-097). ref_doc is a polymorphic soft-ref text pointer to
--     the source doc (e.g. 'stock_transfer:<uuid>' | 'material_issue:<uuid>' |
--     'gr:<uuid>' | 'adjustment') — text, not FK, because it spans doc types.
--   • Valuation (B1 standard-cost, no FIFO): the ledger stores QTY ONLY. Money =
--     inventory_item.price × SUM(qty), computed server-side at read time.
--
-- FK note: company_id → company (cascade, universal). item_id → inventory_item
--   and warehouse_id → warehouse are BOTH NOT NULL + ON DELETE cascade — a
--   per-warehouse balance is meaningless without a real item and warehouse, so
--   unlike the nullable set-null warehouse refs in 0005 these are hard. (orch-A
--   may prefer ON DELETE restrict to block deletion of a warehouse/item that
--   still holds stock — the ERP-safer choice; seed has no delete path so either
--   is safe for gates. Pick one and note it in channel.)
CREATE TABLE "stock_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"ref_doc" text,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- tenant filter + the balance rollup key (SUM(qty) GROUP BY item,warehouse WHERE company)
CREATE INDEX "stock_ledger_company_idx" ON "stock_ledger" ("company_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_item_wh_idx" ON "stock_ledger" ("company_id","item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_warehouse_idx" ON "stock_ledger" ("warehouse_id");--> statement-breakpoint


-- ----------------------------------------------------------------------------
-- 2) transfer_line  —  B3: per-item detail lines of a stock_transfer
-- ----------------------------------------------------------------------------
-- The stock_transfer header (0005) keeps only aggregate qty + value; the
-- prototype transfer form (inventory.jsx:529-568) edits a real line array
-- ({code,name,unit,qty,price}) and shows total = Σ qty×price. This child table
-- captures that per-line fidelity so a transfer renders real rows, and so the
-- approve op (B4) can post one stock_ledger pair PER line inside the B-097 tx.
--   • transfer_id → stock_transfer, NOT NULL, cascade (child — gr_item precedent).
--   • item_id → inventory_item, NOT NULL, cascade (the line's subject).
--   • qty numeric(18,4) (per-line moved quantity).
--   • from_wh / to_wh → warehouse (nullable, ON DELETE set null): per-line
--     override of the header from/to; NULL = fall back to the header warehouses.
--     Nullable set-null mirrors the header warehouse refs in 0005.
--   • NO money column — line value is server-derived (qty × inventory_item.price,
--     standard cost B1); the money total lives on stock_transfer.value +
--     currency_code (already in 0005). Tenant scope = transfer.company_id.
CREATE TABLE "transfer_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"from_wh" uuid,
	"to_wh" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_transfer_id_stock_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_from_wh_warehouse_id_fk" FOREIGN KEY ("from_wh") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_to_wh_warehouse_id_fk" FOREIGN KEY ("to_wh") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_line_transfer_idx" ON "transfer_line" ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfer_line_item_idx" ON "transfer_line" ("item_id");--> statement-breakpoint


-- ----------------------------------------------------------------------------
-- 3) issue_line  —  B3: per-item detail lines of a material_issue
-- ----------------------------------------------------------------------------
-- The material_issue header (0005) keeps only aggregate value; the prototype
-- issue form (inventory.jsx:596-644) edits a line array with a live over-stock
-- danger guard. This child table captures the per-line detail and carries the
-- cost-center pointer that drives B5 (issue posts cost-to-BOQ, server money).
--   • issue_id → material_issue, NOT NULL, cascade (child — gr_item precedent).
--   • item_id → inventory_item, NOT NULL, cascade (the issued item).
--   • qty numeric(18,4) (issued quantity; drives the -qty stock_ledger row @
--     material_issue.from_warehouse_id, guarded by B6 negative-stock 409).
--   • cc_id → cost_center, nullable, ON DELETE set null — the cost target for
--     B5: on issue post the server computes qty × inventory_item.price (standard
--     cost) and posts that cost to the BOQ/cost-center (GR→AP class · money=server).
--     Mirrors petty_cash_txn.cc_id → cost_center set-null in 0005.
--   • NO money column here — cost is server-computed at post time (B1/B5).
-- NOTE (money rule): if orch-A decides to FREEZE the standard cost at issue time
--   (so a later item.price change does not retro-alter posted cost), add
--   "unit_cost" numeric(16,2) + "currency_code" text DEFAULT 'THB' NOT NULL to
--   this table — that snapshot IS money and MUST carry currency_code. Left OUT of
--   this draft because the prototype recomputes qty×price live (no frozen field);
--   compute-at-post keeps a single source of truth. orch-A's call.
CREATE TABLE "issue_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"cc_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_line" ADD CONSTRAINT "issue_line_issue_id_material_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."material_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_line" ADD CONSTRAINT "issue_line_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_line" ADD CONSTRAINT "issue_line_cc_id_cost_center_id_fk" FOREIGN KEY ("cc_id") REFERENCES "public"."cost_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_line_issue_idx" ON "issue_line" ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_line_item_idx" ON "issue_line" ("item_id");--> statement-breakpoint
CREATE INDEX "issue_line_cc_idx" ON "issue_line" ("cc_id");--> statement-breakpoint


-- ============================================================================
-- ADDITIVE-ONLY CHECK (orch-B verify gate)
--   • 3 CREATE TABLE + FK/INDEX only. Zero ALTER/DROP on the 4 existing 0005
--     inventory tables → migration is purely additive (drizzle check safe, no
--     data-loss path, no USING-cast). inventory_item.stock scalar is LEFT INTACT;
--     the ledger becomes the balance source of truth at the handler layer, and a
--     later cutover (backfill ledger from stock, then deprecate the scalar) is a
--     separate, non-blocking chunk — not part of this additive round.
-- OPEN DECISIONS for orch-A to lock in channel.md before generating:
--   1. stock_ledger item_id/warehouse_id ON DELETE: cascade (drafted) vs restrict.
--   2. issue_line frozen cost snapshot: omit (drafted, compute-at-post) vs add
--      unit_cost + currency_code.
--   3. Confirm the claimed migration number (0041?) once labor 0040 lands.
-- ============================================================================
