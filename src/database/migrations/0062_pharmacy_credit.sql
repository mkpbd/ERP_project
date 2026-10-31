ALTER TABLE "pharmacy_sales" DROP CONSTRAINT "pharmacy_sales_due_member_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ALTER COLUMN "loyal_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD COLUMN "corporate_client_id" uuid;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD COLUMN "corporate_client_id" uuid;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD CONSTRAINT "pharmacy_due_collections_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD CONSTRAINT "pharmacy_due_collections_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pharmacy_due_collections_client_idx" ON "pharmacy_due_collections" USING btree ("corporate_client_id");--> statement-breakpoint
CREATE INDEX "pharmacy_due_collections_staff_idx" ON "pharmacy_due_collections" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_client_idx" ON "pharmacy_sales" USING btree ("corporate_client_id");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_staff_idx" ON "pharmacy_sales" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD CONSTRAINT "pharmacy_due_collections_payer_ck" CHECK (num_nonnulls("pharmacy_due_collections"."loyal_member_id", "pharmacy_due_collections"."corporate_client_id", "pharmacy_due_collections"."staff_id") = 1);--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_debtor_ck" CHECK (num_nonnulls("pharmacy_sales"."loyal_member_id", "pharmacy_sales"."corporate_client_id", "pharmacy_sales"."staff_id") <= 1
        and ("pharmacy_sales"."due" = 0 or num_nonnulls("pharmacy_sales"."loyal_member_id", "pharmacy_sales"."corporate_client_id", "pharmacy_sales"."staff_id") = 1));