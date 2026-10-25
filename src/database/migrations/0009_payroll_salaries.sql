CREATE TABLE "salary_increments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"arrear" numeric(12, 2) DEFAULT 0 NOT NULL,
	"before" jsonb NOT NULL,
	"salary_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_by" uuid,
	"committed_at" timestamp with time zone,
	CONSTRAINT "salary_increments_period_ck" CHECK ("salary_increments"."year" between 2000 and 2100 and "salary_increments"."month" between 1 and 12),
	CONSTRAINT "salary_increments_amounts_ck" CHECK ("salary_increments"."amount" > 0 and "salary_increments"."arrear" >= 0),
	CONSTRAINT "salary_increments_status_ck" CHECK ("salary_increments"."status" in ('pending', 'committed'))
);
--> statement-breakpoint
CREATE TABLE "salary_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"basic_percent_of_gross" numeric(5, 2) NOT NULL,
	"house_rent_percent_of_basic" numeric(5, 2) NOT NULL,
	"medical_percent_of_basic" numeric(5, 2) NOT NULL,
	"pf_percent_of_basic" numeric(5, 2) DEFAULT 0 NOT NULL,
	"cpf_percent_of_basic" numeric(5, 2) DEFAULT 0 NOT NULL,
	"conveyance_cap" numeric(12, 2) DEFAULT 2500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_policies_name_len_ck" CHECK (char_length("salary_policies"."name") between 1 and 100),
	CONSTRAINT "salary_policies_percent_ck" CHECK ("salary_policies"."basic_percent_of_gross" between 0 and 100 and "salary_policies"."house_rent_percent_of_basic" between 0 and 100
        and "salary_policies"."medical_percent_of_basic" between 0 and 100 and "salary_policies"."pf_percent_of_basic" between 0 and 100
        and "salary_policies"."cpf_percent_of_basic" between 0 and 100),
	CONSTRAINT "salary_policies_cap_ck" CHECK ("salary_policies"."conveyance_cap" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_review_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_review_cycles_name_len_ck" CHECK (char_length("salary_review_cycles"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "staff_salaries" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"policy_id" uuid NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"basic" numeric(12, 2) NOT NULL,
	"house_rent" numeric(12, 2) NOT NULL,
	"medical" numeric(12, 2) NOT NULL,
	"conveyance" numeric(12, 2) NOT NULL,
	"other_allowance" numeric(12, 2) NOT NULL,
	"pf" numeric(12, 2) NOT NULL,
	"cpf" numeric(12, 2) NOT NULL,
	"pf_enabled" boolean NOT NULL,
	"special_allowance" numeric(12, 2) DEFAULT 0 NOT NULL,
	"other_fixed" numeric(12, 2) DEFAULT 0 NOT NULL,
	"overtime_rate_per_hour" numeric(12, 2) DEFAULT 0 NOT NULL,
	"taxable_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"increment_method" text NOT NULL,
	"increment_percent" numeric(5, 2) DEFAULT 10 NOT NULL,
	"fixed_increment" numeric(12, 2) DEFAULT 0 NOT NULL,
	"review_cycle_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_salaries_gross_ck" CHECK ("staff_salaries"."gross" > 0),
	CONSTRAINT "staff_salaries_amounts_ck" CHECK ("staff_salaries"."basic" >= 0 and "staff_salaries"."house_rent" >= 0 and "staff_salaries"."medical" >= 0 and "staff_salaries"."conveyance" >= 0
        and "staff_salaries"."other_allowance" >= 0 and "staff_salaries"."pf" >= 0 and "staff_salaries"."cpf" >= 0 and "staff_salaries"."special_allowance" >= 0
        and "staff_salaries"."other_fixed" >= 0 and "staff_salaries"."overtime_rate_per_hour" >= 0 and "staff_salaries"."taxable_amount" >= 0
        and "staff_salaries"."fixed_increment" >= 0),
	CONSTRAINT "staff_salaries_increment_method_ck" CHECK ("staff_salaries"."increment_method" in ('percentage', 'fixed', 'individual')),
	CONSTRAINT "staff_salaries_increment_percent_ck" CHECK ("staff_salaries"."increment_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "salary_increments" ADD CONSTRAINT "salary_increments_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_increments" ADD CONSTRAINT "salary_increments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_increments" ADD CONSTRAINT "salary_increments_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_policy_id_salary_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."salary_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_review_cycle_id_salary_review_cycles_id_fk" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."salary_review_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salary_increments_staff_period_uq" ON "salary_increments" USING btree ("staff_id","year","month");--> statement-breakpoint
CREATE INDEX "salary_increments_period_idx" ON "salary_increments" USING btree ("year","month","status");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_policies_name_uq" ON "salary_policies" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "salary_review_cycles_name_uq" ON "salary_review_cycles" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "staff_salaries_policy_idx" ON "staff_salaries" USING btree ("policy_id");