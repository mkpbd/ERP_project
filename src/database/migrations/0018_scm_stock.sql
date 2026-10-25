CREATE TABLE "grn_faults" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"description" text NOT NULL,
	"noted_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grn_faults_qty_ck" CHECK ("grn_faults"."qty" > 0),
	CONSTRAINT "grn_faults_description_len_ck" CHECK (char_length("grn_faults"."description") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"batch_no" text,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"main_store_id" uuid,
	"sub_store_id" uuid,
	"variant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"moved_on" date NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_store_ck" CHECK (("stock_movements"."main_store_id" is null) <> ("stock_movements"."sub_store_id" is null)),
	CONSTRAINT "stock_movements_qty_ck" CHECK ("stock_movements"."qty" <> 0 and "stock_movements"."unit_cost" >= 0),
	CONSTRAINT "stock_movements_kind_ck" CHECK ("stock_movements"."kind" in ('opening', 'receive'))
);
--> statement-breakpoint
CREATE TABLE "stock_openings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"main_store_id" uuid,
	"sub_store_id" uuid,
	"opened_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_openings_store_ck" CHECK (("stock_openings"."main_store_id" is null) <> ("stock_openings"."sub_store_id" is null))
);
--> statement-breakpoint
CREATE TABLE "stock_receive_lines" (
	"receive_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"vat_percent" numeric(5, 2) NOT NULL,
	"ait_percent" numeric(5, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"ait" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"batch_no" text,
	"expiry_date" date,
	"warranty_note" text,
	"lot_id" uuid,
	CONSTRAINT "stock_receive_lines_receive_id_position_pk" PRIMARY KEY("receive_id","position"),
	CONSTRAINT "stock_receive_lines_amounts_ck" CHECK ("stock_receive_lines"."qty" > 0 and "stock_receive_lines"."rate" >= 0 and "stock_receive_lines"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_receives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"main_store_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"received_on" date NOT NULL,
	"supplier_invoice_no" text,
	"supplier_invoice_date" date,
	"challan_no" text,
	"remarks" text,
	"status" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"ait" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"voucher_id" uuid,
	"voucher_number" text,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_receives_status_ck" CHECK ("stock_receives"."status" in ('draft', 'posted')),
	CONSTRAINT "stock_receives_posted_ck" CHECK (("stock_receives"."status" = 'posted') = ("stock_receives"."posted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "grn_faults" ADD CONSTRAINT "grn_faults_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_faults" ADD CONSTRAINT "grn_faults_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_openings" ADD CONSTRAINT "stock_openings_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_openings" ADD CONSTRAINT "stock_openings_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_openings" ADD CONSTRAINT "stock_openings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_lines" ADD CONSTRAINT "stock_receive_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_lines" ADD CONSTRAINT "stock_receive_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receive_lines" ADD CONSTRAINT "stock_receive_lines_receive_fk" FOREIGN KEY ("receive_id") REFERENCES "public"."stock_receives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receives" ADD CONSTRAINT "stock_receives_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receives" ADD CONSTRAINT "stock_receives_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receives" ADD CONSTRAINT "stock_receives_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receives" ADD CONSTRAINT "stock_receives_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receives" ADD CONSTRAINT "stock_receives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receives" ADD CONSTRAINT "stock_receives_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grn_faults_order_idx" ON "grn_faults" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_uq" ON "stock_lots" USING btree ("variant_id",coalesce(upper("batch_no"), ''),coalesce("expiry_date", '9999-12-31'::date));--> statement-breakpoint
CREATE INDEX "stock_lots_expiry_idx" ON "stock_lots" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "stock_movements_main_idx" ON "stock_movements" USING btree ("main_store_id","variant_id","moved_on");--> statement-breakpoint
CREATE INDEX "stock_movements_sub_idx" ON "stock_movements" USING btree ("sub_store_id","variant_id","moved_on");--> statement-breakpoint
CREATE INDEX "stock_movements_lot_idx" ON "stock_movements" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "stock_movements_document_idx" ON "stock_movements" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_openings_number_uq" ON "stock_openings" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_receive_lines_variant_idx" ON "stock_receive_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receives_number_uq" ON "stock_receives" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receives_invoice_uq" ON "stock_receives" USING btree ("supplier_id",upper("supplier_invoice_no")) WHERE "stock_receives"."supplier_invoice_no" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_receives_challan_uq" ON "stock_receives" USING btree ("supplier_id",upper("challan_no")) WHERE "stock_receives"."challan_no" is not null;--> statement-breakpoint
CREATE INDEX "stock_receives_supplier_idx" ON "stock_receives" USING btree ("supplier_id","received_on");--> statement-breakpoint
CREATE INDEX "stock_receives_order_idx" ON "stock_receives" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "stock_receives_status_idx" ON "stock_receives" USING btree ("status","received_on");