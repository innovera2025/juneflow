CREATE UNIQUE INDEX "ap_deposit_company_no_uq" ON "ap_deposit" USING btree ("company_id","no");--> statement-breakpoint
CREATE UNIQUE INDEX "jv_company_no_uq" ON "jv" USING btree ("company_id","no");