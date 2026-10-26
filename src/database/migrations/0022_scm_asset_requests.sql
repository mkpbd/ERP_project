CREATE TABLE "asset_approval_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"flow" text NOT NULL,
	"level_order" smallint NOT NULL,
	"name" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_approval_levels_flow_ck" CHECK ("asset_approval_levels"."flow" in ('service', 'discard', 'scrap_sale')),
	CONSTRAINT "asset_approval_levels_order_ck" CHECK ("asset_approval_levels"."level_order" between 1 and 20),
	CONSTRAINT "asset_approval_levels_name_len_ck" CHECK (char_length("asset_approval_levels"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "asset_decisions" (
	"document_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"level_name" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"remarks" text,
	CONSTRAINT "asset_decisions_document_id_level_order_pk" PRIMARY KEY("document_id","level_order"),
	CONSTRAINT "asset_decisions_decision_ck" CHECK ("asset_decisions"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "asset_locks" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"request_id" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_discard_request_lines" (
	"request_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"asset_id" uuid NOT NULL,
	"reason" text,
	"rejected" boolean NOT NULL,
	"sale_amount" numeric(14, 2),
	"book_value" numeric(14, 2),
	CONSTRAINT "asset_discard_request_lines_request_id_position_pk" PRIMARY KEY("request_id","position"),
	CONSTRAINT "asset_discard_request_lines_amount_ck" CHECK ("asset_discard_request_lines"."sale_amount" is null or "asset_discard_request_lines"."sale_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_discard_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"request_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"current_level" smallint,
	"discarded_on" date,
	"disposal_run_id" uuid,
	"disposal_voucher_number" text,
	"sold_on" date,
	"sold_to" text,
	"invoice_no" text,
	"sale_voucher_number" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_discard_requests_status_ck" CHECK ("asset_discard_requests"."status" in ('pending', 'discarded', 'sold', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "scrap_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"sale_date" date NOT NULL,
	"buyer" text NOT NULL,
	"status" text NOT NULL,
	"current_level" smallint,
	"lines" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"invoice_no" text,
	"voucher_number" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scrap_sales_status_ck" CHECK ("scrap_sales"."status" in ('pending', 'sold', 'rejected')),
	CONSTRAINT "scrap_sales_total_ck" CHECK ("scrap_sales"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_service_request_lines" (
	"request_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"asset_id" uuid NOT NULL,
	"service_type" text NOT NULL,
	"problem" text,
	"cost" numeric(14, 2) NOT NULL,
	"rejected" boolean NOT NULL,
	"returned_on" date,
	CONSTRAINT "asset_service_request_lines_request_id_position_pk" PRIMARY KEY("request_id","position"),
	CONSTRAINT "asset_service_request_lines_type_ck" CHECK ("asset_service_request_lines"."service_type" in ('warranty', 'maintenance')),
	CONSTRAINT "asset_service_request_lines_cost_ck" CHECK ("asset_service_request_lines"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "asset_service_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"request_date" date NOT NULL,
	"sent_to" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"current_level" smallint,
	"gate_pass_id" uuid,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_service_requests_status_ck" CHECK ("asset_service_requests"."status" in ('pending', 'approved', 'closed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD COLUMN "kind" text DEFAULT 'periodic' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_approval_levels" ADD CONSTRAINT "asset_approval_levels_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_decisions" ADD CONSTRAINT "asset_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_locks" ADD CONSTRAINT "asset_locks_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_discard_request_lines" ADD CONSTRAINT "asset_discard_request_lines_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_discard_request_lines" ADD CONSTRAINT "asset_discard_request_lines_fk" FOREIGN KEY ("request_id") REFERENCES "public"."asset_discard_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD CONSTRAINT "asset_discard_requests_disposal_run_id_depreciation_runs_id_fk" FOREIGN KEY ("disposal_run_id") REFERENCES "public"."depreciation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_discard_requests" ADD CONSTRAINT "asset_discard_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrap_sales" ADD CONSTRAINT "scrap_sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service_request_lines" ADD CONSTRAINT "asset_service_request_lines_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service_request_lines" ADD CONSTRAINT "asset_service_request_lines_fk" FOREIGN KEY ("request_id") REFERENCES "public"."asset_service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service_requests" ADD CONSTRAINT "asset_service_requests_gate_pass_id_gate_passes_id_fk" FOREIGN KEY ("gate_pass_id") REFERENCES "public"."gate_passes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_service_requests" ADD CONSTRAINT "asset_service_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_approval_levels_order_uq" ON "asset_approval_levels" USING btree ("flow","level_order");--> statement-breakpoint
CREATE INDEX "asset_locks_request_idx" ON "asset_locks" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "asset_discard_request_lines_asset_idx" ON "asset_discard_request_lines" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_discard_requests_number_uq" ON "asset_discard_requests" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_discard_requests_invoice_uq" ON "asset_discard_requests" USING btree ("invoice_no") WHERE "asset_discard_requests"."invoice_no" is not null;--> statement-breakpoint
CREATE INDEX "asset_discard_requests_status_idx" ON "asset_discard_requests" USING btree ("status","request_date");--> statement-breakpoint
CREATE UNIQUE INDEX "scrap_sales_number_uq" ON "scrap_sales" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "scrap_sales_invoice_uq" ON "scrap_sales" USING btree ("invoice_no") WHERE "scrap_sales"."invoice_no" is not null;--> statement-breakpoint
CREATE INDEX "asset_service_request_lines_asset_idx" ON "asset_service_request_lines" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_service_requests_number_uq" ON "asset_service_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "asset_service_requests_status_idx" ON "asset_service_requests" USING btree ("status","request_date");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_ck" CHECK ("stock_movements"."kind" in ('opening', 'receive', 'issue', 'transfer', 'consumption', 'department_return', 'adjustment', 'supplier_return', 'discard'));