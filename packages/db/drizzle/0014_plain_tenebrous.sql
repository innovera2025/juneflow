ALTER TABLE "project_type" DROP CONSTRAINT "project_type_key_unique";--> statement-breakpoint
ALTER TABLE "project_type" ALTER COLUMN "key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "project_type" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "project_type" ADD CONSTRAINT "project_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_type_company_idx" ON "project_type" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "project_type" ADD CONSTRAINT "project_type_company_key_uq" UNIQUE("company_id","key");--> statement-breakpoint
DROP TYPE "public"."project_type_key";