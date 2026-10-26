CREATE TABLE "asset_depreciation" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"frequency" text NOT NULL,
	"life_months" smallint NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"residual" numeric(14, 2) NOT NULL,
	"start_date" date NOT NULL,
	"opening_accumulated" numeric(14, 2) DEFAULT 0 NOT NULL,
	"periods_done" smallint NOT NULL,
	"accumulated" numeric(14, 2) NOT NULL,
	"last_period_end" date,
	"status" text NOT NULL,
	"configured_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_depreciation_frequency_ck" CHECK ("asset_depreciation"."frequency" in ('monthly', 'quarterly', 'half_yearly', 'yearly')),
	CONSTRAINT "asset_depreciation_status_ck" CHECK ("asset_depreciation"."status" in ('active', 'fully_depreciated', 'suspended', 'disposed')),
	CONSTRAINT "asset_depreciation_amounts_ck" CHECK ("asset_depreciation"."residual" between 0 and "asset_depreciation"."cost" and "asset_depreciation"."accumulated" between 0 and "asset_depreciation"."cost" - "asset_depreciation"."residual"
        and "asset_depreciation"."life_months" between 1 and 1200 and "asset_depreciation"."periods_done" >= 0)
);
--> statement-breakpoint
CREATE TABLE "depreciation_entries" (
	"run_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_index" smallint NOT NULL,
	"period_end" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"department_id" uuid,
	CONSTRAINT "depreciation_entries_run_id_asset_id_period_index_pk" PRIMARY KEY("run_id","asset_id","period_index"),
	CONSTRAINT "depreciation_entries_amount_ck" CHECK ("depreciation_entries"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "depreciation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"as_of" date NOT NULL,
	"status" text NOT NULL,
	"asset_count" integer NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"voucher_id" uuid,
	"voucher_number" text,
	"reversal_voucher_id" uuid,
	"reversal_voucher_number" text,
	"reverse_reason" text,
	"posted_by" uuid,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "depreciation_runs_status_ck" CHECK ("depreciation_runs"."status" in ('posted', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_no" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"source_number" text NOT NULL,
	"supplier_id" uuid,
	"cost" numeric(14, 2) NOT NULL,
	"acquired_on" date NOT NULL,
	"status" text NOT NULL,
	"main_store_id" uuid,
	"sub_store_id" uuid,
	"department_id" uuid,
	"serial_no" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_assets_status_ck" CHECK ("fixed_assets"."status" in ('in_stock', 'out_for_service', 'discarded', 'sold', 'returned')),
	CONSTRAINT "fixed_assets_place_ck" CHECK (num_nonnulls("fixed_assets"."main_store_id", "fixed_assets"."sub_store_id", "fixed_assets"."department_id") <= 1),
	CONSTRAINT "fixed_assets_cost_ck" CHECK ("fixed_assets"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_asset" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_depreciation" ADD CONSTRAINT "asset_depreciation_configured_by_users_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_run_id_depreciation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."depreciation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_reversal_voucher_id_vouchers_id_fk" FOREIGN KEY ("reversal_voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_entries_period_uq" ON "depreciation_entries" USING btree ("asset_id","period_index");--> statement-breakpoint
CREATE UNIQUE INDEX "depreciation_runs_number_uq" ON "depreciation_runs" USING btree ("number");--> statement-breakpoint
CREATE INDEX "depreciation_runs_as_of_idx" ON "depreciation_runs" USING btree ("as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_assets_no_uq" ON "fixed_assets" USING btree ("asset_no");--> statement-breakpoint
CREATE INDEX "fixed_assets_variant_idx" ON "fixed_assets" USING btree ("variant_id","lot_id","status");--> statement-breakpoint
CREATE INDEX "fixed_assets_department_idx" ON "fixed_assets" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "fixed_assets_source_idx" ON "fixed_assets" USING btree ("source_document_id");