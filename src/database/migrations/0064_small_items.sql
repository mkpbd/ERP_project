CREATE TABLE "account_budgets" (
	"fiscal_year_id" uuid NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_budgets_fiscal_year_id_gl_account_id_pk" PRIMARY KEY("fiscal_year_id","gl_account_id"),
	CONSTRAINT "account_budgets_amount_ck" CHECK ("account_budgets"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_card_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"contact_no" text,
	"discount_percent" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_card_providers_name_ck" CHECK (char_length("hospital_card_providers"."name") between 1 and 100),
	CONSTRAINT "hospital_card_providers_percent_ck" CHECK ("hospital_card_providers"."discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_test_preparations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid,
	"test_id" uuid,
	"title" text NOT NULL,
	"title_bn" text,
	"instructions" text,
	"instructions_bn" text,
	"video_url" text,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_test_preparations_target_ck" CHECK (num_nonnulls("hospital_test_preparations"."department_id", "hospital_test_preparations"."test_id") = 1),
	CONSTRAINT "hospital_test_preparations_title_ck" CHECK (char_length("hospital_test_preparations"."title") between 1 and 200),
	CONSTRAINT "hospital_test_preparations_content_ck" CHECK ("hospital_test_preparations"."instructions" is not null or "hospital_test_preparations"."video_url" is not null),
	CONSTRAINT "hospital_test_preparations_video_ck" CHECK ("hospital_test_preparations"."video_url" is null or "hospital_test_preparations"."video_url" ~ '^https://[^ ]+$'),
	CONSTRAINT "hospital_test_preparations_order_ck" CHECK ("hospital_test_preparations"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_tax_challans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"challan_no" text NOT NULL,
	"challan_date" date NOT NULL,
	"bank" text,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_tax_challans_period_ck" CHECK ("payroll_tax_challans"."pay_year" between 2000 and 2100 and "payroll_tax_challans"."pay_month" between 1 and 12),
	CONSTRAINT "payroll_tax_challans_amount_ck" CHECK ("payroll_tax_challans"."amount" > 0),
	CONSTRAINT "payroll_tax_challans_no_ck" CHECK (char_length("payroll_tax_challans"."challan_no") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_lot_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"product_id" uuid NOT NULL,
	"from_lot_id" uuid NOT NULL,
	"to_lot_id" uuid NOT NULL,
	"corrected_on" date NOT NULL,
	"units" integer NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_lot_corrections_lots_ck" CHECK ("pharmacy_lot_corrections"."from_lot_id" <> "pharmacy_lot_corrections"."to_lot_id" and "pharmacy_lot_corrections"."units" > 0)
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD COLUMN "card_provider_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_budgets" ADD CONSTRAINT "account_budgets_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_budgets" ADD CONSTRAINT "account_budgets_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_budgets" ADD CONSTRAINT "account_budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_preparations" ADD CONSTRAINT "hospital_test_preparations_department_id_hospital_diagnostic_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hospital_diagnostic_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_preparations" ADD CONSTRAINT "hospital_test_preparations_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_tax_challans" ADD CONSTRAINT "payroll_tax_challans_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_lot_corrections" ADD CONSTRAINT "pharmacy_lot_corrections_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_lot_corrections" ADD CONSTRAINT "pharmacy_lot_corrections_from_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("from_lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_lot_corrections" ADD CONSTRAINT "pharmacy_lot_corrections_to_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("to_lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_lot_corrections" ADD CONSTRAINT "pharmacy_lot_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_budgets_account_idx" ON "account_budgets" USING btree ("gl_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_card_providers_name_uq" ON "hospital_card_providers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "hospital_test_preparations_department_idx" ON "hospital_test_preparations" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "hospital_test_preparations_test_idx" ON "hospital_test_preparations" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_tax_challans_month_uq" ON "payroll_tax_challans" USING btree ("staff_id","pay_year","pay_month");--> statement-breakpoint
CREATE INDEX "payroll_tax_challans_period_idx" ON "payroll_tax_challans" USING btree ("pay_year","pay_month");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_lot_corrections_number_uq" ON "pharmacy_lot_corrections" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_lot_corrections_from_idx" ON "pharmacy_lot_corrections" USING btree ("from_lot_id");--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_card_provider_id_hospital_card_providers_id_fk" FOREIGN KEY ("card_provider_id") REFERENCES "public"."hospital_card_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_card_ck" CHECK ("hospital_diagnostic_bills"."card_provider_id" is null or ("hospital_diagnostic_bills"."corporate_client_id" is null and "hospital_diagnostic_bills"."staff_id" is null and "hospital_diagnostic_bills"."admission_id" is null));--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in', 'sale', 'sale_cancel', 'sale_return', 'count_adjustment', 'ward_issue', 'ward_return', 'lot_correction'));