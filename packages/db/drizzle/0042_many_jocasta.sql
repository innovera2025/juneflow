CREATE TABLE "down_payment_txn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_unit_id" uuid NOT NULL,
	"seq" integer,
	"due_date" date,
	"amount" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"paid_at" date,
	"rv_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_unit_id" uuid,
	"bank" text,
	"ask_amt" numeric(16, 2),
	"approved_amt" numeric(16, 2),
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"term" integer,
	"submit_date" date,
	"result_date" date,
	"status" text DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "jv_source_doc_uq";--> statement-breakpoint
ALTER TABLE "land_plot" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "land_plot" ADD COLUMN "tambon" text;--> statement-breakpoint
ALTER TABLE "land_plot" ADD COLUMN "amphoe" text;--> statement-breakpoint
ALTER TABLE "land_plot" ADD COLUMN "prov" text;--> statement-breakpoint
ALTER TABLE "land_plot" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "warmth" text;--> statement-breakpoint
UPDATE "lead" SET "warmth" = CASE WHEN "hot" THEN 'hot' ELSE 'warm' END WHERE "warmth" IS NULL;--> statement-breakpoint
ALTER TABLE "down_payment_txn" ADD CONSTRAINT "down_payment_txn_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "down_payment_txn" ADD CONSTRAINT "down_payment_txn_sales_unit_id_sales_unit_id_fk" FOREIGN KEY ("sales_unit_id") REFERENCES "public"."sales_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_application" ADD CONSTRAINT "loan_application_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_application" ADD CONSTRAINT "loan_application_sales_unit_id_sales_unit_id_fk" FOREIGN KEY ("sales_unit_id") REFERENCES "public"."sales_unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "down_payment_txn_company_idx" ON "down_payment_txn" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "down_payment_txn_unit_idx" ON "down_payment_txn" USING btree ("sales_unit_id");--> statement-breakpoint
CREATE INDEX "loan_application_company_idx" ON "loan_application" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jv_source_doc_uq" ON "jv" USING btree ("source_doc") WHERE "jv"."source_doc" ~ '^(pv|rv|gr|payroll|fa|cn|ret|dep|booking|down|transfer|deal):';