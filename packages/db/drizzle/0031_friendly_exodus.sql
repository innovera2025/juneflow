CREATE TABLE "evm_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_end" date NOT NULL,
	"pv" numeric(16, 2) DEFAULT '0' NOT NULL,
	"ev" numeric(16, 2) DEFAULT '0' NOT NULL,
	"ac" numeric(16, 2) DEFAULT '0' NOT NULL,
	"budget" numeric(16, 2) DEFAULT '0' NOT NULL,
	"bac" numeric(16, 2) DEFAULT '0' NOT NULL,
	"currency_code" text DEFAULT 'THB' NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evm_snapshot_project_period_uq" UNIQUE("project_id","period")
);
--> statement-breakpoint
ALTER TABLE "evm_snapshot" ADD CONSTRAINT "evm_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evm_snapshot_project_idx" ON "evm_snapshot" USING btree ("project_id");