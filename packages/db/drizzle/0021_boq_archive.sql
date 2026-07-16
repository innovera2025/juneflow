CREATE TABLE "boq_version_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"action" text,
	"by" uuid,
	"at" timestamp with time zone,
	"delta" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boq_doc" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "boq_doc" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "boq_version_history" ADD CONSTRAINT "boq_version_history_doc_id_boq_doc_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."boq_doc"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_version_history" ADD CONSTRAINT "boq_version_history_by_user_id_fk" FOREIGN KEY ("by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_doc" ADD CONSTRAINT "boq_doc_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;