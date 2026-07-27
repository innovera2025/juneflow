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
ALTER TABLE "warehouse" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "warehouse" ADD COLUMN "capacity" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "issue_line" ADD CONSTRAINT "issue_line_issue_id_material_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."material_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_line" ADD CONSTRAINT "issue_line_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_transfer_id_stock_transfer_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_from_wh_warehouse_id_fk" FOREIGN KEY ("from_wh") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_line" ADD CONSTRAINT "transfer_line_to_wh_warehouse_id_fk" FOREIGN KEY ("to_wh") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_line_issue_idx" ON "issue_line" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_company_idx" ON "stock_ledger" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_item_wh_idx" ON "stock_ledger" USING btree ("company_id","item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_warehouse_idx" ON "stock_ledger" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "transfer_line_transfer_idx" ON "transfer_line" USING btree ("transfer_id");