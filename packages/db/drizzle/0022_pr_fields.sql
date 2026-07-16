ALTER TABLE "pr" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "pr" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "pr" ADD COLUMN "requester_id" uuid;--> statement-breakpoint
ALTER TABLE "pr" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "pr" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr" ADD CONSTRAINT "pr_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr" ADD CONSTRAINT "pr_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;