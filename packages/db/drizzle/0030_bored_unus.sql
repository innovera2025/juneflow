CREATE INDEX "ap_billing_vendor_idx" ON "ap_billing" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "jv_line_jv_idx" ON "jv_line" USING btree ("jv_id");--> statement-breakpoint
CREATE INDEX "jv_period_idx" ON "jv" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "reconcile_statement_idx" ON "reconcile" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "reconcile_period_idx" ON "reconcile" USING btree ("period_id");