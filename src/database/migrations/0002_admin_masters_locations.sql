CREATE TABLE "admin_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_departments_name_len_ck" CHECK (char_length("admin_departments"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "discount_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_categories_name_len_ck" CHECK (char_length("discount_categories"."name") between 1 and 100),
	CONSTRAINT "discount_categories_percent_ck" CHECK ("discount_categories"."discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "editor_shortcuts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_shortcuts_code_len_ck" CHECK (char_length("editor_shortcuts"."code") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "investigation_entry_page_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"control_id" text NOT NULL,
	"is_grid_or_list_view" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipd_admission_page_controls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"control_id" text NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_mode_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_channels_name_len_ck" CHECK (char_length("payment_channels"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "payment_modes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_modes_name_len_ck" CHECK (char_length("payment_modes"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"use_area" text DEFAULT '' NOT NULL,
	"page_size" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printers_name_len_ck" CHECK (char_length("printers"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "serve_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serve_types_name_len_ck" CHECK (char_length("serve_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "service_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_units_name_len_ck" CHECK (char_length("service_units"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "tenant_logos" (
	"tenant_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tenant_logos_pk" PRIMARY KEY("tenant_id","slot"),
	CONSTRAINT "tenant_logos_slot_ck" CHECK ("tenant_logos"."slot" in ('primary', 'secondary')),
	CONSTRAINT "tenant_logos_type_ck" CHECK ("tenant_logos"."content_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "tenant_logos_size_ck" CHECK (octet_length("tenant_logos"."data") between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_alt" text,
	"short_name" text,
	"address" text DEFAULT '' NOT NULL,
	"hotline" text,
	"district_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_name_len_ck" CHECK (char_length("tenants"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nationality" text DEFAULT '' NOT NULL,
	"short_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_name_len_ck" CHECK (char_length("countries"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"division_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_bn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_name_len_ck" CHECK (char_length("districts"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divisions_name_len_ck" CHECK (char_length("divisions"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "discount_categories" ADD CONSTRAINT "discount_categories_department_id_admin_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."admin_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_channels" ADD CONSTRAINT "payment_channels_payment_mode_id_payment_modes_id_fk" FOREIGN KEY ("payment_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_units" ADD CONSTRAINT "service_units_department_id_admin_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."admin_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_logos" ADD CONSTRAINT "tenant_logos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_logos" ADD CONSTRAINT "tenant_logos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_departments_name_uq" ON "admin_departments" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "discount_categories_department_name_uq" ON "discount_categories" USING btree ("department_id",lower("name"));--> statement-breakpoint
CREATE INDEX "discount_categories_department_idx" ON "discount_categories" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editor_shortcuts_code_uq" ON "editor_shortcuts" USING btree (lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "investigation_entry_page_controls_control_uq" ON "investigation_entry_page_controls" USING btree ("control_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ipd_admission_page_controls_control_uq" ON "ipd_admission_page_controls" USING btree ("control_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_channels_mode_name_uq" ON "payment_channels" USING btree ("payment_mode_id",lower("name"));--> statement-breakpoint
CREATE INDEX "payment_channels_mode_idx" ON "payment_channels" USING btree ("payment_mode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_modes_name_uq" ON "payment_modes" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "serve_types_name_uq" ON "serve_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "service_units_department_name_uq" ON "service_units" USING btree ("department_id",lower("name"));--> statement-breakpoint
CREATE INDEX "service_units_department_idx" ON "service_units" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "tenants_district_idx" ON "tenants" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_name_uq" ON "countries" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "countries_short_code_uq" ON "countries" USING btree (upper("short_code"));--> statement-breakpoint
CREATE UNIQUE INDEX "districts_division_name_uq" ON "districts" USING btree ("division_id",lower("name"));--> statement-breakpoint
CREATE INDEX "districts_division_idx" ON "districts" USING btree ("division_id");--> statement-breakpoint
CREATE UNIQUE INDEX "divisions_name_uq" ON "divisions" USING btree (lower("name"));