CREATE TABLE "department_store_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_department_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_store_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_categories_name_len_ck" CHECK (char_length("item_categories"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "item_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_groups_name_len_ck" CHECK (char_length("item_groups"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "item_sub_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_sub_categories_name_len_ck" CHECK (char_length("item_sub_categories"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "item_sub_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_sub_groups_name_len_ck" CHECK (char_length("item_sub_groups"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "item_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"alternate_name" text,
	"specification" text,
	"purchase_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sale_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"expiry_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_variants_name_len_ck" CHECK (char_length("item_variants"."name") between 1 and 200),
	CONSTRAINT "item_variants_amounts_ck" CHECK ("item_variants"."purchase_price" >= 0 and "item_variants"."sale_price" >= 0 and "item_variants"."reorder_level" >= 0)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sub_group_id" uuid NOT NULL,
	"sub_category_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"type_gl_account_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_name_len_ck" CHECK (char_length("items"."name") between 1 and 200),
	CONSTRAINT "items_unit_len_ck" CHECK (char_length("items"."unit") between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "main_stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "main_stores_name_len_ck" CHECK (char_length("main_stores"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "role_group_restrictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_departments_name_len_ck" CHECK (char_length("store_departments"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "sub_stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"main_store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_stores_name_len_ck" CHECK (char_length("sub_stores"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "supplier_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_types_name_len_ck" CHECK (char_length("supplier_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"contact_no" text,
	"email" text,
	"is_enlisted" boolean DEFAULT false NOT NULL,
	"enlisted_on" date,
	"enlistment_expires_on" date,
	"vat_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"is_manufacturer" boolean DEFAULT false NOT NULL,
	"gl_account_id" uuid,
	"sub_ledger_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_len_ck" CHECK (char_length("suppliers"."name") between 1 and 200),
	CONSTRAINT "suppliers_rates_ck" CHECK ("suppliers"."vat_percent" between 0 and 100 and "suppliers"."tax_percent" between 0 and 100),
	CONSTRAINT "suppliers_enlistment_ck" CHECK ("suppliers"."enlistment_expires_on" is null or "suppliers"."enlisted_on" is null or "suppliers"."enlistment_expires_on" >= "suppliers"."enlisted_on")
);
--> statement-breakpoint
ALTER TABLE "department_store_access" ADD CONSTRAINT "department_store_access_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_store_access" ADD CONSTRAINT "department_store_access_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_store_access" ADD CONSTRAINT "department_store_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_department_users" ADD CONSTRAINT "store_department_users_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_department_users" ADD CONSTRAINT "store_department_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_store_users" ADD CONSTRAINT "issue_store_users_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_store_users" ADD CONSTRAINT "issue_store_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sub_categories" ADD CONSTRAINT "item_sub_categories_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sub_groups" ADD CONSTRAINT "item_sub_groups_group_id_item_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."item_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sub_group_id_item_sub_groups_id_fk" FOREIGN KEY ("sub_group_id") REFERENCES "public"."item_sub_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sub_category_id_item_sub_categories_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."item_sub_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_type_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("type_gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_group_restrictions" ADD CONSTRAINT "role_group_restrictions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_group_restrictions" ADD CONSTRAINT "role_group_restrictions_group_id_item_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."item_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_stores" ADD CONSTRAINT "sub_stores_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_type_id_supplier_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."supplier_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_sub_ledger_id_sub_ledgers_id_fk" FOREIGN KEY ("sub_ledger_id") REFERENCES "public"."sub_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_store_access_uq" ON "department_store_access" USING btree ("department_id","sub_store_id","user_id");--> statement-breakpoint
CREATE INDEX "department_store_access_user_idx" ON "department_store_access" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_department_users_uq" ON "store_department_users" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX "store_department_users_user_idx" ON "store_department_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_store_users_uq" ON "issue_store_users" USING btree ("sub_store_id","user_id");--> statement-breakpoint
CREATE INDEX "issue_store_users_user_idx" ON "issue_store_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_categories_name_uq" ON "item_categories" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_groups_name_uq" ON "item_groups" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_sub_categories_name_uq" ON "item_sub_categories" USING btree ("category_id",upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_sub_groups_name_uq" ON "item_sub_groups" USING btree ("group_id",upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_variants_name_uq" ON "item_variants" USING btree ("item_id",upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_variants_code_uq" ON "item_variants" USING btree (upper("code")) WHERE "item_variants"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "items_name_uq" ON "items" USING btree ("sub_group_id",upper("name"));--> statement-breakpoint
CREATE INDEX "items_sub_category_idx" ON "items" USING btree ("sub_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "main_stores_name_uq" ON "main_stores" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "role_group_restrictions_uq" ON "role_group_restrictions" USING btree ("role_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_departments_name_uq" ON "store_departments" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "sub_stores_name_uq" ON "sub_stores" USING btree (upper("name"));--> statement-breakpoint
CREATE INDEX "sub_stores_main_store_idx" ON "sub_stores" USING btree ("main_store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_types_name_uq" ON "supplier_types" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_uq" ON "suppliers" USING btree (upper("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_sub_ledger_uq" ON "suppliers" USING btree ("sub_ledger_id") WHERE "suppliers"."sub_ledger_id" is not null;--> statement-breakpoint
CREATE INDEX "suppliers_type_idx" ON "suppliers" USING btree ("type_id");