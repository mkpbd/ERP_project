CREATE TABLE "pharmacy_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_no" text,
	"expiry_date" date NOT NULL,
	"sale_rate" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_lots_sale_rate_ck" CHECK ("pharmacy_lots"."sale_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"moved_on" date NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_movements_qty_ck" CHECK ("pharmacy_movements"."qty" <> 0 and "pharmacy_movements"."unit_cost" >= 0),
	CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive'))
);
--> statement-breakpoint
CREATE TABLE "pharmacy_openings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"opened_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_purchase_order_lines" (
	"order_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pharmacy_purchase_order_lines_order_id_position_pk" PRIMARY KEY("order_id","position"),
	CONSTRAINT "pharmacy_purchase_order_lines_qty_ck" CHECK ("pharmacy_purchase_order_lines"."qty" > 0 and "pharmacy_purchase_order_lines"."received_qty" between 0 and "pharmacy_purchase_order_lines"."qty")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"order_date" date NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"close_reason" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_purchase_orders_status_ck" CHECK ("pharmacy_purchase_orders"."status" in ('open', 'partly_received', 'received', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "pharmacy_receive_lines" (
	"receive_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"qty" integer NOT NULL,
	"purchase_rate" numeric(16, 4) NOT NULL,
	"sale_rate" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"vat_percent" numeric(5, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"batch_no" text,
	"expiry_date" date NOT NULL,
	CONSTRAINT "pharmacy_receive_lines_receive_id_position_pk" PRIMARY KEY("receive_id","position"),
	CONSTRAINT "pharmacy_receive_lines_qty_ck" CHECK ("pharmacy_receive_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_receives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
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
	"total" numeric(14, 2) NOT NULL,
	"voucher_id" uuid,
	"voucher_number" text,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_receives_status_ck" CHECK ("pharmacy_receives"."status" in ('draft', 'posted'))
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sequences" (
	"kind" text NOT NULL,
	"year" smallint NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "pharmacy_sequences_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
ALTER TABLE "pharmacy_lots" ADD CONSTRAINT "pharmacy_lots_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_openings" ADD CONSTRAINT "pharmacy_openings_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_openings" ADD CONSTRAINT "pharmacy_openings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_order_lines" ADD CONSTRAINT "pharmacy_purchase_order_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_order_lines" ADD CONSTRAINT "pharmacy_purchase_order_lines_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pharmacy_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_orders" ADD CONSTRAINT "pharmacy_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_orders" ADD CONSTRAINT "pharmacy_purchase_orders_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_purchase_orders" ADD CONSTRAINT "pharmacy_purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receive_lines" ADD CONSTRAINT "pharmacy_receive_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receive_lines" ADD CONSTRAINT "pharmacy_receive_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receive_lines" ADD CONSTRAINT "pharmacy_receive_lines_fk" FOREIGN KEY ("receive_id") REFERENCES "public"."pharmacy_receives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receives" ADD CONSTRAINT "pharmacy_receives_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receives" ADD CONSTRAINT "pharmacy_receives_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receives" ADD CONSTRAINT "pharmacy_receives_purchase_order_id_pharmacy_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."pharmacy_purchase_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receives" ADD CONSTRAINT "pharmacy_receives_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receives" ADD CONSTRAINT "pharmacy_receives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_receives" ADD CONSTRAINT "pharmacy_receives_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_lots_uq" ON "pharmacy_lots" USING btree ("product_id",coalesce(upper("batch_no"), ''),"expiry_date","sale_rate");--> statement-breakpoint
CREATE INDEX "pharmacy_lots_expiry_idx" ON "pharmacy_lots" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "pharmacy_movements_outlet_idx" ON "pharmacy_movements" USING btree ("outlet_id","product_id","moved_on");--> statement-breakpoint
CREATE INDEX "pharmacy_movements_lot_idx" ON "pharmacy_movements" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "pharmacy_movements_document_idx" ON "pharmacy_movements" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_openings_number_uq" ON "pharmacy_openings" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_purchase_order_lines_product_uq" ON "pharmacy_purchase_order_lines" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_purchase_orders_number_uq" ON "pharmacy_purchase_orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_purchase_orders_supplier_idx" ON "pharmacy_purchase_orders" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "pharmacy_receive_lines_product_idx" ON "pharmacy_receive_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_receives_number_uq" ON "pharmacy_receives" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_receives_invoice_uq" ON "pharmacy_receives" USING btree ("supplier_id",upper("supplier_invoice_no")) WHERE "pharmacy_receives"."supplier_invoice_no" is not null;--> statement-breakpoint
CREATE INDEX "pharmacy_receives_date_idx" ON "pharmacy_receives" USING btree ("received_on");