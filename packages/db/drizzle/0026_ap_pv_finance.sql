CREATE TYPE "public"."pv_method" AS ENUM('cash', 'transfer', 'cheque', 'deposit');--> statement-breakpoint
ALTER TABLE "ap_billing" ADD COLUMN "wht" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "ap_billing" ADD COLUMN "retention" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "ap_billing" ADD COLUMN "wo_id" uuid;--> statement-breakpoint
ALTER TABLE "cheque" ADD COLUMN "pv_id" uuid;--> statement-breakpoint
ALTER TABLE "pv" ADD COLUMN "amount" numeric(16, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pv" ADD COLUMN "retention" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "pv" ADD COLUMN "method" "pv_method";--> statement-breakpoint
ALTER TABLE "pv" ADD COLUMN "cheque_no" text;--> statement-breakpoint
ALTER TABLE "pv" ADD COLUMN "cheque_bank" text;--> statement-breakpoint
ALTER TABLE "pv" ADD COLUMN "cheque_date" date;--> statement-breakpoint
ALTER TABLE "ap_billing" ADD CONSTRAINT "ap_billing_wo_id_wo_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."wo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque" ADD CONSTRAINT "cheque_pv_id_pv_id_fk" FOREIGN KEY ("pv_id") REFERENCES "public"."pv"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ap_billing_wo_idx" ON "ap_billing" USING btree ("wo_id");--> statement-breakpoint
CREATE INDEX "cheque_pv_idx" ON "cheque" USING btree ("pv_id");