CREATE TABLE "pharmacy_return_policies" (
	"channel" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean NOT NULL,
	"days" smallint NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_return_policies_channel_ck" CHECK ("pharmacy_return_policies"."channel" in ('opd', 'ipd')),
	CONSTRAINT "pharmacy_return_policies_days_ck" CHECK ("pharmacy_return_policies"."days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sale_return_lines" (
	"return_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"sale_line" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"sale_rate" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"refund" numeric(14, 2) NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	CONSTRAINT "pharmacy_sale_return_lines_return_id_position_pk" PRIMARY KEY("return_id","position"),
	CONSTRAINT "pharmacy_sale_return_lines_qty_ck" CHECK ("pharmacy_sale_return_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sale_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"returned_on" date NOT NULL,
	"reason" text,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"refund" numeric(14, 2) NOT NULL,
	"due_reduced" numeric(14, 2) NOT NULL,
	"cash_refund" numeric(14, 2) NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"voucher_number" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_sale_returns_amounts_ck" CHECK ("pharmacy_sale_returns"."refund" = "pharmacy_sale_returns"."amount" - "pharmacy_sale_returns"."discount" and "pharmacy_sale_returns"."refund" = "pharmacy_sale_returns"."due_reduced" + "pharmacy_sale_returns"."cash_refund")
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_sale_lines" DROP CONSTRAINT "pharmacy_sale_lines_qty_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_sales" DROP CONSTRAINT "pharmacy_sales_amounts_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_sale_lines" ADD COLUMN "returned_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD COLUMN "returned" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD COLUMN "due_returned" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_return_policies" ADD CONSTRAINT "pharmacy_return_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_return_lines" ADD CONSTRAINT "pharmacy_sale_return_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_return_lines" ADD CONSTRAINT "pharmacy_sale_return_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_return_lines" ADD CONSTRAINT "pharmacy_sale_return_lines_fk" FOREIGN KEY ("return_id") REFERENCES "public"."pharmacy_sale_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_returns" ADD CONSTRAINT "pharmacy_sale_returns_sale_id_pharmacy_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_returns" ADD CONSTRAINT "pharmacy_sale_returns_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_returns" ADD CONSTRAINT "pharmacy_sale_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_sale_returns_number_uq" ON "pharmacy_sale_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_sale_returns_sale_idx" ON "pharmacy_sale_returns" USING btree ("sale_id");--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in', 'sale', 'sale_cancel', 'sale_return'));--> statement-breakpoint
ALTER TABLE "pharmacy_sale_lines" ADD CONSTRAINT "pharmacy_sale_lines_qty_ck" CHECK ("pharmacy_sale_lines"."qty" > 0 and "pharmacy_sale_lines"."returned_qty" between 0 and "pharmacy_sale_lines"."qty");--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_amounts_ck" CHECK ("pharmacy_sales"."total" = "pharmacy_sales"."amount" - "pharmacy_sales"."discount" and "pharmacy_sales"."paid" + "pharmacy_sales"."due" = "pharmacy_sales"."total" and "pharmacy_sales"."collected" + "pharmacy_sales"."due_returned" between 0 and "pharmacy_sales"."due" and "pharmacy_sales"."returned" between 0 and "pharmacy_sales"."total");