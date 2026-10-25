CREATE TABLE "income_tax_deductions" (
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"tax_year_id" uuid NOT NULL,
	"taxable_income" numeric(12, 2),
	"yearly_tax" numeric(12, 2),
	"monthly_tax" numeric(12, 2) NOT NULL,
	"source" text NOT NULL,
	"remarks" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "income_tax_deductions_staff_id_pay_year_pay_month_pk" PRIMARY KEY("staff_id","pay_year","pay_month"),
	CONSTRAINT "income_tax_deductions_period_ck" CHECK ("income_tax_deductions"."pay_year" between 2000 and 2100 and "income_tax_deductions"."pay_month" between 1 and 12),
	CONSTRAINT "income_tax_deductions_amount_ck" CHECK ("income_tax_deductions"."monthly_tax" >= 0),
	CONSTRAINT "income_tax_deductions_source_ck" CHECK ("income_tax_deductions"."source" in ('computed', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "income_tax_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"male_slabs" jsonb NOT NULL,
	"female_slabs" jsonb NOT NULL,
	"male_exemption_cap" numeric(12, 2) NOT NULL,
	"female_exemption_cap" numeric(12, 2) NOT NULL,
	"rebate_on_taxable_percent" numeric(5, 2) DEFAULT 3 NOT NULL,
	"investment_allowance_percent" numeric(5, 2) DEFAULT 20 NOT NULL,
	"rebate_on_investment_percent" numeric(5, 2) DEFAULT 15 NOT NULL,
	"rebate_cap" numeric(12, 2) DEFAULT 1000000 NOT NULL,
	"minimum_monthly_tax" numeric(12, 2) DEFAULT 417 NOT NULL,
	"male_minimum_tax_gross" numeric(12, 2) NOT NULL,
	"female_minimum_tax_gross" numeric(12, 2) NOT NULL,
	"expected_bonus_basics" numeric(4, 2) DEFAULT 2.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "income_tax_years_dates_ck" CHECK ("income_tax_years"."ends_on" > "income_tax_years"."starts_on"),
	CONSTRAINT "income_tax_years_label_len_ck" CHECK (char_length("income_tax_years"."label") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "income_tax_deductions" ADD CONSTRAINT "income_tax_deductions_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_tax_deductions" ADD CONSTRAINT "income_tax_deductions_tax_year_id_income_tax_years_id_fk" FOREIGN KEY ("tax_year_id") REFERENCES "public"."income_tax_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_tax_deductions" ADD CONSTRAINT "income_tax_deductions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "income_tax_years_label_uq" ON "income_tax_years" USING btree ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "income_tax_years_start_uq" ON "income_tax_years" USING btree ("starts_on");