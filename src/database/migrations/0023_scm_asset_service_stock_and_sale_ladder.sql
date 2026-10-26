ALTER TABLE "asset_approval_levels" DROP CONSTRAINT "asset_approval_levels_flow_ck";--> statement-breakpoint
ALTER TABLE "asset_discard_requests" DROP CONSTRAINT "asset_discard_requests_status_ck";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "asset_decisions" ADD COLUMN "position" smallint;--> statement-breakpoint
ALTER TABLE "asset_decisions" ADD COLUMN "stage" text DEFAULT 'request' NOT NULL;--> statement-breakpoint
UPDATE "asset_decisions" AS d SET "position" = o.n FROM (SELECT "document_id", "level_order", (row_number() OVER (PARTITION BY "document_id" ORDER BY "decided_at", "level_order") - 1)::smallint AS n FROM "asset_decisions") AS o WHERE o."document_id" = d."document_id" AND o."level_order" = d."level_order";--> statement-breakpoint
ALTER TABLE "asset_decisions" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_decisions" ALTER COLUMN "stage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "asset_decisions" DROP CONSTRAINT "asset_decisions_document_id_level_order_pk";--> statement-breakpoint
ALTER TABLE "asset_decisions" ADD CONSTRAINT "asset_decisions_document_id_position_pk" PRIMARY KEY("document_id","position");--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD COLUMN "buyer_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD COLUMN "sale_proposed_by" uuid;--> statement-breakpoint
ALTER TABLE "scrap_sales" ADD COLUMN "buyer_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_service_request_lines" ADD COLUMN "actual_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "asset_service_request_lines" ADD COLUMN "receipt_voucher_number" text;--> statement-breakpoint
ALTER TABLE "asset_service_requests" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD CONSTRAINT "asset_discard_requests_buyer_supplier_id_suppliers_id_fk" FOREIGN KEY ("buyer_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD CONSTRAINT "asset_discard_requests_sale_proposed_by_users_id_fk" FOREIGN KEY ("sale_proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_sales" ADD CONSTRAINT "scrap_sales_buyer_supplier_id_suppliers_id_fk" FOREIGN KEY ("buyer_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service_requests" ADD CONSTRAINT "asset_service_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_approval_levels" ADD CONSTRAINT "asset_approval_levels_flow_ck" CHECK ("asset_approval_levels"."flow" in ('service', 'discard', 'discard_sale', 'scrap_sale'));--> statement-breakpoint
ALTER TABLE "asset_decisions" ADD CONSTRAINT "asset_decisions_stage_ck" CHECK ("asset_decisions"."stage" in ('request', 'sale'));--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD CONSTRAINT "asset_discard_requests_status_ck" CHECK ("asset_discard_requests"."status" in ('pending', 'discarded', 'sale_pending', 'sold', 'rejected'));--> statement-breakpoint
ALTER TABLE "asset_service_request_lines" ADD CONSTRAINT "asset_service_request_lines_actual_ck" CHECK ("asset_service_request_lines"."actual_cost" is null or "asset_service_request_lines"."actual_cost" >= 0);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_ck" CHECK ("stock_movements"."kind" in ('opening', 'receive', 'issue', 'transfer', 'consumption', 'department_return', 'adjustment', 'supplier_return', 'discard', 'service_out', 'service_return'));