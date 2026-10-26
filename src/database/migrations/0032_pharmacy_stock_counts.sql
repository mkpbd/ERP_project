CREATE TABLE "pharmacy_stock_count_lines" (
	"count_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"system_qty" integer NOT NULL,
	"counted_qty" integer,
	"unit_cost" numeric(16, 4) NOT NULL,
	"note" text,
	"applied_system_qty" integer,
	"adjusted_qty" integer,
	CONSTRAINT "pharmacy_stock_count_lines_count_id_position_pk" PRIMARY KEY("count_id","position"),
	CONSTRAINT "pharmacy_stock_count_lines_qty_ck" CHECK ("pharmacy_stock_count_lines"."system_qty" >= 0 and ("pharmacy_stock_count_lines"."counted_qty" is null or "pharmacy_stock_count_lines"."counted_qty" >= 0) and "pharmacy_stock_count_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_stock_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"count_date" date NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"shortage_value" numeric(14, 2) DEFAULT 0 NOT NULL,
	"excess_value" numeric(14, 2) DEFAULT 0 NOT NULL,
	"voucher_number" text,
	"cancel_reason" text,
	"created_by" uuid,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_stock_counts_status_ck" CHECK ("pharmacy_stock_counts"."status" in ('counting', 'applied', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_stock_count_lines" ADD CONSTRAINT "pharmacy_stock_count_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_count_lines" ADD CONSTRAINT "pharmacy_stock_count_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_count_lines" ADD CONSTRAINT "pharmacy_stock_count_lines_fk" FOREIGN KEY ("count_id") REFERENCES "public"."pharmacy_stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_counts" ADD CONSTRAINT "pharmacy_stock_counts_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_counts" ADD CONSTRAINT "pharmacy_stock_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_stock_counts" ADD CONSTRAINT "pharmacy_stock_counts_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_stock_count_lines_lot_uq" ON "pharmacy_stock_count_lines" USING btree ("count_id","lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_stock_counts_number_uq" ON "pharmacy_stock_counts" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_stock_counts_outlet_idx" ON "pharmacy_stock_counts" USING btree ("outlet_id","count_date");--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in', 'sale', 'sale_cancel', 'sale_return', 'count_adjustment'));