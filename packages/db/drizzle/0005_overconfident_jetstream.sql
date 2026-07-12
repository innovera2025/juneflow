CREATE TYPE "public"."lead_stage" AS ENUM('lead', 'visit', 'quote', 'booking', 'contract');--> statement-breakpoint
CREATE TYPE "public"."petty_cash_type" AS ENUM('claim', 'clear', 'topup');--> statement-breakpoint
CREATE TABLE "ar_credit_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"customer_id" uuid,
	"ref_invoice_id" uuid,
	"reason" text,
	"amount" numeric(16, 2) NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"status" text,
	"note_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_comparison_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_comparison_id" uuid NOT NULL,
	"vendor_id" uuid,
	"price" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"credit_term" text,
	"shipping" numeric(16, 2),
	"score" numeric(6, 2),
	"is_best" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bid_comparison" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pr_id" uuid,
	"title" text,
	"decided_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_numbering" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"prefix" text,
	"running" integer DEFAULT 1 NOT NULL,
	"reset_rule" text,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"code" text NOT NULL,
	"cat" text,
	"name" text NOT NULL,
	"unit" text,
	"price" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"stock" numeric(18, 4) DEFAULT '0' NOT NULL,
	"low_point" numeric(18, 4),
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"source" text,
	"interest" text,
	"stage" "lead_stage" DEFAULT 'lead' NOT NULL,
	"hot" boolean DEFAULT false NOT NULL,
	"last_contact_at" date,
	"note" text,
	"owner_user_id" uuid,
	"days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"project_id" uuid,
	"from_warehouse_id" uuid,
	"value" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"issue_date" date,
	"by_user_id" uuid,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"label" text NOT NULL,
	"day" integer,
	"milestone_date" date,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" integer,
	"icon" text,
	"name" text NOT NULL,
	"code" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"type" "petty_cash_type" NOT NULL,
	"label" text,
	"value" numeric(16, 2) NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"by_user_id" uuid,
	"txn_date" date,
	"status" text,
	"cat" text,
	"ref" text,
	"cc_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ppa_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"month" text,
	"mwh" numeric(14, 4),
	"rate" numeric(12, 4),
	"amount" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"wo_id" uuid,
	"vendor_id" uuid,
	"contract_id" uuid,
	"scope" text,
	"rate" numeric(6, 2),
	"withheld" numeric(16, 2),
	"returned" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"due_date" date,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rev_rec" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"method" text,
	"contract_amount" numeric(16, 2),
	"pct" numeric(6, 2),
	"recognized" numeric(16, 2),
	"billed" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"posted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"unit_id" uuid,
	"customer_id" uuid,
	"channel" text,
	"category" text,
	"title" text NOT NULL,
	"priority" text,
	"status" text,
	"assignee_user_id" uuid,
	"opened_date" date,
	"scheduled_date" date,
	"warranty" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solar_inverter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"zone" text,
	"kw" numeric(12, 3),
	"output_kw" numeric(12, 3),
	"perf" numeric(6, 2),
	"temp" numeric(6, 2),
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solar_om_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"inverter_id" uuid,
	"no" text NOT NULL,
	"title" text,
	"priority" text,
	"assignee_user_id" uuid,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solar_permit_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"org" text,
	"status" text,
	"step_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solar_roi" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"year" integer,
	"revenue" numeric(16, 2),
	"opex" numeric(16, 2),
	"cumulative" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solar_warranty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"item" text NOT NULL,
	"brand" text,
	"qty" integer,
	"perf" numeric(6, 2),
	"prod_date" date,
	"expiry_date" date,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"no" text NOT NULL,
	"from_warehouse_id" uuid,
	"to_warehouse_id" uuid,
	"qty" numeric(18, 4),
	"value" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"transfer_date" date,
	"by_user_id" uuid,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"group_label" text,
	"label" text NOT NULL,
	"plan_start" date,
	"plan_end" date,
	"actual_start" date,
	"actual_end" date,
	"status" text,
	"pct" numeric(6, 2),
	"late" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"material" numeric(16, 2),
	"subcon" numeric(16, 2),
	"overhead" numeric(16, 2),
	"transferred" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "group_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "short" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "doc_prefix" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "biz" text;--> statement-breakpoint
ALTER TABLE "role" ADD COLUMN "perms" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ar_credit_note" ADD CONSTRAINT "ar_credit_note_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_credit_note" ADD CONSTRAINT "ar_credit_note_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_credit_note" ADD CONSTRAINT "ar_credit_note_ref_invoice_id_ar_invoice_id_fk" FOREIGN KEY ("ref_invoice_id") REFERENCES "public"."ar_invoice"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_comparison_line" ADD CONSTRAINT "bid_comparison_line_bid_comparison_id_bid_comparison_id_fk" FOREIGN KEY ("bid_comparison_id") REFERENCES "public"."bid_comparison"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_comparison_line" ADD CONSTRAINT "bid_comparison_line_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_comparison" ADD CONSTRAINT "bid_comparison_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_comparison" ADD CONSTRAINT "bid_comparison_pr_id_pr_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pr"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_numbering" ADD CONSTRAINT "doc_numbering_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_issue" ADD CONSTRAINT "material_issue_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit" ADD CONSTRAINT "org_unit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit" ADD CONSTRAINT "org_unit_parent_id_org_unit_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_txn" ADD CONSTRAINT "petty_cash_txn_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_txn" ADD CONSTRAINT "petty_cash_txn_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_txn" ADD CONSTRAINT "petty_cash_txn_cc_id_cost_center_id_fk" FOREIGN KEY ("cc_id") REFERENCES "public"."cost_center"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_invoice" ADD CONSTRAINT "ppa_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ppa_invoice" ADD CONSTRAINT "ppa_invoice_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_ledger" ADD CONSTRAINT "retention_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_ledger" ADD CONSTRAINT "retention_ledger_wo_id_wo_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."wo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_ledger" ADD CONSTRAINT "retention_ledger_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_ledger" ADD CONSTRAINT "retention_ledger_contract_id_subcon_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."subcon_contract"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rev_rec" ADD CONSTRAINT "rev_rec_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rev_rec" ADD CONSTRAINT "rev_rec_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_ticket" ADD CONSTRAINT "service_ticket_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_ticket" ADD CONSTRAINT "service_ticket_unit_id_project_node_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."project_node"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_ticket" ADD CONSTRAINT "service_ticket_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_ticket" ADD CONSTRAINT "service_ticket_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_inverter" ADD CONSTRAINT "solar_inverter_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_inverter" ADD CONSTRAINT "solar_inverter_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_om_ticket" ADD CONSTRAINT "solar_om_ticket_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_om_ticket" ADD CONSTRAINT "solar_om_ticket_inverter_id_solar_inverter_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."solar_inverter"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_om_ticket" ADD CONSTRAINT "solar_om_ticket_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_permit_step" ADD CONSTRAINT "solar_permit_step_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_permit_step" ADD CONSTRAINT "solar_permit_step_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_roi" ADD CONSTRAINT "solar_roi_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_roi" ADD CONSTRAINT "solar_roi_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_warranty" ADD CONSTRAINT "solar_warranty_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solar_warranty" ADD CONSTRAINT "solar_warranty_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_warehouse_id_warehouse_id_fk" FOREIGN KEY ("from_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_warehouse_id_warehouse_id_fk" FOREIGN KEY ("to_warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_task" ADD CONSTRAINT "timeline_task_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_task" ADD CONSTRAINT "timeline_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip" ADD CONSTRAINT "wip_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wip" ADD CONSTRAINT "wip_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_group_parent_id_company_id_fk" FOREIGN KEY ("group_parent_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;