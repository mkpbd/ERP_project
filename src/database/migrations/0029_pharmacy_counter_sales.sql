CREATE TABLE "pharmacy_discount_policy" (
	"id" smallint PRIMARY KEY NOT NULL,
	"allowed_by_default" boolean NOT NULL,
	"opd_percent" numeric(5, 2) NOT NULL,
	"ipd_percent" numeric(5, 2),
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_discount_policy_one_ck" CHECK ("pharmacy_discount_policy"."id" = 1),
	CONSTRAINT "pharmacy_discount_policy_percent_ck" CHECK ("pharmacy_discount_policy"."opd_percent" between 0 and 100 and ("pharmacy_discount_policy"."ipd_percent" is null or "pharmacy_discount_policy"."ipd_percent" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "pharmacy_due_collection_lines" (
	"collection_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "pharmacy_due_collection_lines_collection_id_sale_id_pk" PRIMARY KEY("collection_id","sale_id"),
	CONSTRAINT "pharmacy_due_collection_lines_amount_ck" CHECK ("pharmacy_due_collection_lines"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_due_collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"loyal_member_id" uuid NOT NULL,
	"collected_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"amount" numeric(14, 2) NOT NULL,
	"voucher_number" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_due_collections_amount_ck" CHECK ("pharmacy_due_collections"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_loyal_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_no" text NOT NULL,
	"reference_name" text,
	"remarks" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_loyal_members_name_len_ck" CHECK (char_length("pharmacy_loyal_members"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sale_lines" (
	"sale_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"sale_rate" numeric(14, 2) NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	CONSTRAINT "pharmacy_sale_lines_sale_id_position_pk" PRIMARY KEY("sale_id","position"),
	CONSTRAINT "pharmacy_sale_lines_qty_ck" CHECK ("pharmacy_sale_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"sold_on" date NOT NULL,
	"customer_name" text,
	"mobile_no" text,
	"loyal_member_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"tendered" numeric(14, 2) NOT NULL,
	"paid" numeric(14, 2) NOT NULL,
	"due" numeric(14, 2) NOT NULL,
	"collected" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"cancelled_on" date,
	"voucher_number" text,
	"cancel_voucher_number" text,
	"sold_by" uuid,
	"cancelled_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_sales_status_ck" CHECK ("pharmacy_sales"."status" in ('completed', 'cancelled')),
	CONSTRAINT "pharmacy_sales_method_ck" CHECK ("pharmacy_sales"."method" in ('cash', 'card', 'mobile')),
	CONSTRAINT "pharmacy_sales_amounts_ck" CHECK ("pharmacy_sales"."total" = "pharmacy_sales"."amount" - "pharmacy_sales"."discount" and "pharmacy_sales"."paid" + "pharmacy_sales"."due" = "pharmacy_sales"."total" and "pharmacy_sales"."collected" between 0 and "pharmacy_sales"."due"),
	CONSTRAINT "pharmacy_sales_due_member_ck" CHECK ("pharmacy_sales"."due" = 0 or "pharmacy_sales"."loyal_member_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_product_discounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"is_allowed" boolean NOT NULL,
	"opd_percent" numeric(5, 2),
	"ipd_percent" numeric(5, 2),
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_product_discounts_percent_ck" CHECK (("pharmacy_product_discounts"."opd_percent" is null or "pharmacy_product_discounts"."opd_percent" between 0 and 100) and ("pharmacy_product_discounts"."ipd_percent" is null or "pharmacy_product_discounts"."ipd_percent" between 0 and 100))
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_discount_policy" ADD CONSTRAINT "pharmacy_discount_policy_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collection_lines" ADD CONSTRAINT "pharmacy_due_collection_lines_sale_id_pharmacy_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collection_lines" ADD CONSTRAINT "pharmacy_due_collection_lines_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."pharmacy_due_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD CONSTRAINT "pharmacy_due_collections_loyal_member_id_pharmacy_loyal_members_id_fk" FOREIGN KEY ("loyal_member_id") REFERENCES "public"."pharmacy_loyal_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_due_collections" ADD CONSTRAINT "pharmacy_due_collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_lines" ADD CONSTRAINT "pharmacy_sale_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_lines" ADD CONSTRAINT "pharmacy_sale_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sale_lines" ADD CONSTRAINT "pharmacy_sale_lines_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pharmacy_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_loyal_member_id_pharmacy_loyal_members_id_fk" FOREIGN KEY ("loyal_member_id") REFERENCES "public"."pharmacy_loyal_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_product_discounts" ADD CONSTRAINT "pharmacy_product_discounts_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_due_collections_number_uq" ON "pharmacy_due_collections" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_due_collections_member_idx" ON "pharmacy_due_collections" USING btree ("loyal_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_loyal_members_contact_uq" ON "pharmacy_loyal_members" USING btree ("contact_no");--> statement-breakpoint
CREATE INDEX "pharmacy_sale_lines_product_idx" ON "pharmacy_sale_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_sales_number_uq" ON "pharmacy_sales" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_outlet_idx" ON "pharmacy_sales" USING btree ("outlet_id","sold_on");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_member_idx" ON "pharmacy_sales" USING btree ("loyal_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_product_discounts_product_uq" ON "pharmacy_product_discounts" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in', 'sale', 'sale_cancel'));