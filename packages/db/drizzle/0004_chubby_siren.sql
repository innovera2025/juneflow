CREATE TABLE "pm_quote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wo_id" uuid NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" text,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pm_quote" ADD CONSTRAINT "pm_quote_wo_id_pm_workorder_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."pm_workorder"("id") ON DELETE cascade ON UPDATE no action;