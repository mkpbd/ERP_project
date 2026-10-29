CREATE TABLE "canteen_collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"member_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"voucher_number" text,
	"received_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canteen_collections_amount_ck" CHECK ("canteen_collections"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "canteen_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canteen_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"group_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"staff_rate" numeric(12, 2) NOT NULL,
	"vat_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"stock_variant_id" uuid,
	"stock_qty" numeric(12, 3) DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canteen_items_rates_ck" CHECK ("canteen_items"."rate" >= 0 and "canteen_items"."staff_rate" >= 0 and "canteen_items"."stock_qty" > 0),
	CONSTRAINT "canteen_items_vat_ck" CHECK ("canteen_items"."vat_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "canteen_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mobile_no" text NOT NULL,
	"address" text,
	"reference" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canteen_outlet_users" (
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "canteen_outlet_users_outlet_id_user_id_pk" PRIMARY KEY("outlet_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "canteen_outlets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"store_department_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canteen_sale_lines" (
	"sale_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"vat" numeric(12, 2) NOT NULL,
	CONSTRAINT "canteen_sale_lines_sale_id_position_pk" PRIMARY KEY("sale_id","position"),
	CONSTRAINT "canteen_sale_lines_qty_ck" CHECK ("canteen_sale_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "canteen_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"sold_on" date NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"customer_kind" text NOT NULL,
	"staff_id" uuid,
	"member_id" uuid,
	"customer_name" text,
	"gross" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"vat" numeric(12, 2) NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"paid" numeric(12, 2) NOT NULL,
	"due" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"consumption_number" text,
	"stock_short" boolean DEFAULT false NOT NULL,
	"voucher_number" text,
	"sold_by" uuid,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canteen_sales_due_ck" CHECK ("canteen_sales"."due" = 0 or "canteen_sales"."member_id" is not null),
	CONSTRAINT "canteen_sales_customer_ck" CHECK (("canteen_sales"."customer_kind" = 'staff') = ("canteen_sales"."staff_id" is not null) and ("canteen_sales"."customer_kind" = 'member') = ("canteen_sales"."member_id" is not null)),
	CONSTRAINT "canteen_sales_amounts_ck" CHECK ("canteen_sales"."discount" between 0 and "canteen_sales"."gross" and "canteen_sales"."net" = "canteen_sales"."gross" - "canteen_sales"."discount" + "canteen_sales"."vat" and "canteen_sales"."paid" + "canteen_sales"."due" = "canteen_sales"."net" and "canteen_sales"."paid" >= 0 and "canteen_sales"."due" >= 0)
);
--> statement-breakpoint
CREATE TABLE "canteen_sequences" (
	"kind" text NOT NULL,
	"year" smallint NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "canteen_sequences_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
ALTER TABLE "canteen_collections" ADD CONSTRAINT "canteen_collections_member_id_canteen_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."canteen_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_collections" ADD CONSTRAINT "canteen_collections_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_items" ADD CONSTRAINT "canteen_items_group_id_canteen_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."canteen_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_items" ADD CONSTRAINT "canteen_items_stock_variant_id_item_variants_id_fk" FOREIGN KEY ("stock_variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_outlet_users" ADD CONSTRAINT "canteen_outlet_users_outlet_id_canteen_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."canteen_outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_outlet_users" ADD CONSTRAINT "canteen_outlet_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_outlets" ADD CONSTRAINT "canteen_outlets_store_department_id_store_departments_id_fk" FOREIGN KEY ("store_department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sale_lines" ADD CONSTRAINT "canteen_sale_lines_sale_id_canteen_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."canteen_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sale_lines" ADD CONSTRAINT "canteen_sale_lines_item_id_canteen_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."canteen_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_outlet_id_canteen_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."canteen_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_member_id_canteen_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."canteen_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_sold_by_users_id_fk" FOREIGN KEY ("sold_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canteen_sales" ADD CONSTRAINT "canteen_sales_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_collections_number_uq" ON "canteen_collections" USING btree ("number");--> statement-breakpoint
CREATE INDEX "canteen_collections_member_idx" ON "canteen_collections" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_groups_name_uq" ON "canteen_groups" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_items_code_uq" ON "canteen_items" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_items_name_uq" ON "canteen_items" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_members_mobile_uq" ON "canteen_members" USING btree ("mobile_no");--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_outlets_name_uq" ON "canteen_outlets" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "canteen_sales_number_uq" ON "canteen_sales" USING btree ("number");--> statement-breakpoint
CREATE INDEX "canteen_sales_day_idx" ON "canteen_sales" USING btree ("sold_on","outlet_id");--> statement-breakpoint
CREATE INDEX "canteen_sales_member_idx" ON "canteen_sales" USING btree ("member_id");