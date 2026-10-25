CREATE TABLE "department_adjustment_lines" (
	"adjustment_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"system_qty" numeric(14, 3) NOT NULL,
	"physical_qty" numeric(14, 3) NOT NULL,
	"adjust_qty" numeric(14, 3),
	CONSTRAINT "department_adjustment_lines_adjustment_id_position_pk" PRIMARY KEY("adjustment_id","position"),
	CONSTRAINT "department_adjustment_lines_qty_ck" CHECK ("department_adjustment_lines"."physical_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "department_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"department_id" uuid NOT NULL,
	"counted_on" date NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_remarks" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_adjustments_status_ck" CHECK ("department_adjustments"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "department_consumption_lines" (
	"consumption_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"lot_id" uuid,
	CONSTRAINT "department_consumption_lines_consumption_id_position_pk" PRIMARY KEY("consumption_id","position"),
	CONSTRAINT "department_consumption_lines_qty_ck" CHECK ("department_consumption_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "department_consumptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"department_id" uuid NOT NULL,
	"consumed_on" date NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"created_by" uuid,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_consumptions_status_ck" CHECK ("department_consumptions"."status" in ('posted', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "department_return_lines" (
	"return_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"lot_id" uuid,
	CONSTRAINT "department_return_lines_return_id_position_pk" PRIMARY KEY("return_id","position"),
	CONSTRAINT "department_return_lines_qty_ck" CHECK ("department_return_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "department_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"department_id" uuid NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"received_on" date,
	"received_by" uuid,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_returns_status_ck" CHECK ("department_returns"."status" in ('pending', 'received', 'cancelled')),
	CONSTRAINT "department_returns_received_ck" CHECK (("department_returns"."status" = 'received') = ("department_returns"."received_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "gate_passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"pass_date" date NOT NULL,
	"kind" text NOT NULL,
	"reference" text,
	"party_name" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_passes_kind_ck" CHECK ("gate_passes"."kind" in ('supplier_return', 'maintenance', 'other')),
	CONSTRAINT "gate_passes_name_len_ck" CHECK (char_length("gate_passes"."party_name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "supplier_return_lines" (
	"return_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"lot_id" uuid,
	"unit_cost" numeric(16, 4),
	"received_qty" numeric(14, 3),
	"replacement_variant_id" uuid,
	"replacement_batch_no" text,
	"replacement_expiry_date" date,
	CONSTRAINT "supplier_return_lines_return_id_position_pk" PRIMARY KEY("return_id","position"),
	CONSTRAINT "supplier_return_lines_qty_ck" CHECK ("supplier_return_lines"."qty" > 0 and ("supplier_return_lines"."received_qty" is null or "supplier_return_lines"."received_qty" between 0 and "supplier_return_lines"."qty"))
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"main_store_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"sent_voucher_id" uuid,
	"sent_voucher_number" text,
	"gate_pass_id" uuid,
	"settled_on" date,
	"settled_voucher_id" uuid,
	"settled_voucher_number" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_returns_status_ck" CHECK ("supplier_returns"."status" in ('draft', 'sent', 'settled'))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_store_ck";--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "department_adjustment_lines" ADD CONSTRAINT "department_adjustment_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_adjustment_lines" ADD CONSTRAINT "department_adjustment_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_adjustment_lines" ADD CONSTRAINT "department_adjustment_lines_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."department_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_adjustments" ADD CONSTRAINT "department_adjustments_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_adjustments" ADD CONSTRAINT "department_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_adjustments" ADD CONSTRAINT "department_adjustments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_consumption_lines" ADD CONSTRAINT "department_consumption_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_consumption_lines" ADD CONSTRAINT "department_consumption_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_consumption_lines" ADD CONSTRAINT "department_consumption_lines_fk" FOREIGN KEY ("consumption_id") REFERENCES "public"."department_consumptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_consumptions" ADD CONSTRAINT "department_consumptions_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_consumptions" ADD CONSTRAINT "department_consumptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_consumptions" ADD CONSTRAINT "department_consumptions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_return_lines" ADD CONSTRAINT "department_return_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_return_lines" ADD CONSTRAINT "department_return_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_return_lines" ADD CONSTRAINT "department_return_lines_fk" FOREIGN KEY ("return_id") REFERENCES "public"."department_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_returns" ADD CONSTRAINT "department_returns_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_returns" ADD CONSTRAINT "department_returns_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_returns" ADD CONSTRAINT "department_returns_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_returns" ADD CONSTRAINT "department_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_fk" FOREIGN KEY ("return_id") REFERENCES "public"."supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_replacement_fk" FOREIGN KEY ("replacement_variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_sent_voucher_id_vouchers_id_fk" FOREIGN KEY ("sent_voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_gate_pass_id_gate_passes_id_fk" FOREIGN KEY ("gate_pass_id") REFERENCES "public"."gate_passes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_settled_voucher_id_vouchers_id_fk" FOREIGN KEY ("settled_voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_adjustments_number_uq" ON "department_adjustments" USING btree ("number");--> statement-breakpoint
CREATE INDEX "department_adjustments_department_idx" ON "department_adjustments" USING btree ("department_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "department_consumptions_number_uq" ON "department_consumptions" USING btree ("number");--> statement-breakpoint
CREATE INDEX "department_consumptions_department_idx" ON "department_consumptions" USING btree ("department_id","consumed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "department_returns_number_uq" ON "department_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "department_returns_store_idx" ON "department_returns" USING btree ("sub_store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_passes_number_uq" ON "gate_passes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "gate_passes_date_idx" ON "gate_passes" USING btree ("pass_date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_returns_number_uq" ON "supplier_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "supplier_returns_supplier_idx" ON "supplier_returns" USING btree ("supplier_id","return_date");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_department_idx" ON "stock_movements" USING btree ("department_id","variant_id","moved_on");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_ck" CHECK (num_nonnulls("stock_movements"."main_store_id", "stock_movements"."sub_store_id", "stock_movements"."department_id") = 1);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_ck" CHECK ("stock_movements"."kind" in ('opening', 'receive', 'issue', 'transfer', 'consumption', 'department_return', 'adjustment', 'supplier_return'));