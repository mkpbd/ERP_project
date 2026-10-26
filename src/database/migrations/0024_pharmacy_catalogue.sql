CREATE TABLE "pharmacy_brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_brands_name_len_ck" CHECK (char_length("pharmacy_brands"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_formations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_formations_name_len_ck" CHECK (char_length("pharmacy_formations"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_generic_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_generic_groups_name_len_ck" CHECK (char_length("pharmacy_generic_groups"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_generics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group_id" uuid,
	"info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_generics_name_len_ck" CHECK (char_length("pharmacy_generics"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_manufacturers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_manufacturers_name_len_ck" CHECK (char_length("pharmacy_manufacturers"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_outlet_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_outlets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_outlets_name_len_ck" CHECK (char_length("pharmacy_outlets"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_package_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_package_units_name_len_ck" CHECK (char_length("pharmacy_package_units"."name") between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"generic_id" uuid NOT NULL,
	"formation_id" uuid NOT NULL,
	"strength_id" uuid,
	"unit_id" uuid,
	"package_unit_id" uuid,
	"units_per_pack" integer DEFAULT 1 NOT NULL,
	"purchase_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sale_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"barcode" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_products_amounts_ck" CHECK ("pharmacy_products"."purchase_price" >= 0 and "pharmacy_products"."sale_price" >= 0 and "pharmacy_products"."units_per_pack" between 1 and 10000),
	CONSTRAINT "pharmacy_products_barcode_ck" CHECK ("pharmacy_products"."barcode" is null or char_length("pharmacy_products"."barcode") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_reorder_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_reorder_levels_level_ck" CHECK ("pharmacy_reorder_levels"."level" between 0 and 10000000)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_strengths" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_strengths_name_len_ck" CHECK (char_length("pharmacy_strengths"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_units_name_len_ck" CHECK (char_length("pharmacy_units"."name") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "pharmacy_brands" ADD CONSTRAINT "pharmacy_brands_manufacturer_id_pharmacy_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."pharmacy_manufacturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_generics" ADD CONSTRAINT "pharmacy_generics_group_id_pharmacy_generic_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."pharmacy_generic_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_users" ADD CONSTRAINT "pharmacy_outlet_users_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_users" ADD CONSTRAINT "pharmacy_outlet_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_brand_id_pharmacy_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."pharmacy_brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_generic_id_pharmacy_generics_id_fk" FOREIGN KEY ("generic_id") REFERENCES "public"."pharmacy_generics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_formation_id_pharmacy_formations_id_fk" FOREIGN KEY ("formation_id") REFERENCES "public"."pharmacy_formations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_strength_id_pharmacy_strengths_id_fk" FOREIGN KEY ("strength_id") REFERENCES "public"."pharmacy_strengths"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_unit_id_pharmacy_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."pharmacy_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_products" ADD CONSTRAINT "pharmacy_products_package_unit_id_pharmacy_package_units_id_fk" FOREIGN KEY ("package_unit_id") REFERENCES "public"."pharmacy_package_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_reorder_levels" ADD CONSTRAINT "pharmacy_reorder_levels_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_reorder_levels" ADD CONSTRAINT "pharmacy_reorder_levels_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_brands_name_uq" ON "pharmacy_brands" USING btree ("manufacturer_id",upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_formations_name_uq" ON "pharmacy_formations" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_generic_groups_name_uq" ON "pharmacy_generic_groups" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_generics_name_uq" ON "pharmacy_generics" USING btree (upper("name"));--> statement-breakpoint
CREATE INDEX "pharmacy_generics_group_idx" ON "pharmacy_generics" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_manufacturers_name_uq" ON "pharmacy_manufacturers" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_outlet_users_uq" ON "pharmacy_outlet_users" USING btree ("outlet_id","user_id");--> statement-breakpoint
CREATE INDEX "pharmacy_outlet_users_user_idx" ON "pharmacy_outlet_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_outlets_name_uq" ON "pharmacy_outlets" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_outlets_code_uq" ON "pharmacy_outlets" USING btree (upper("code")) WHERE "pharmacy_outlets"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_package_units_name_uq" ON "pharmacy_package_units" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_products_uq" ON "pharmacy_products" USING btree ("brand_id","formation_id",coalesce("strength_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_products_barcode_uq" ON "pharmacy_products" USING btree ("barcode") WHERE "pharmacy_products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "pharmacy_products_generic_idx" ON "pharmacy_products" USING btree ("generic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_reorder_levels_uq" ON "pharmacy_reorder_levels" USING btree ("outlet_id","product_id");--> statement-breakpoint
CREATE INDEX "pharmacy_reorder_levels_product_idx" ON "pharmacy_reorder_levels" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_strengths_name_uq" ON "pharmacy_strengths" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_units_name_uq" ON "pharmacy_units" USING btree (upper("name"));