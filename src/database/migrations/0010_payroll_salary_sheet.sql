CREATE TABLE "allowance_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"other_allowance" numeric(12, 2) DEFAULT 0 NOT NULL,
	"special_allowance" numeric(12, 2) DEFAULT 0 NOT NULL,
	"salary_refund" numeric(12, 2) DEFAULT 0 NOT NULL,
	"refund_comment" text,
	"paid_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowance_payments_period_ck" CHECK ("allowance_payments"."pay_year" between 2000 and 2100 and "allowance_payments"."pay_month" between 1 and 12),
	CONSTRAINT "allowance_payments_amounts_ck" CHECK ("allowance_payments"."other_allowance" >= 0 and "allowance_payments"."special_allowance" >= 0 and "allowance_payments"."salary_refund" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_arrears" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_arrears_period_ck" CHECK ("salary_arrears"."pay_year" between 2000 and 2100 and "salary_arrears"."pay_month" between 1 and 12),
	CONSTRAINT "salary_arrears_amount_ck" CHECK ("salary_arrears"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "salary_deductions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"lwp_days" numeric(5, 2) DEFAULT 0 NOT NULL,
	"lwp_from" date,
	"lwp_to" date,
	"other_deduction" numeric(12, 2) DEFAULT 0 NOT NULL,
	"ait" numeric(12, 2) DEFAULT 0 NOT NULL,
	"sm" numeric(12, 2) DEFAULT 0 NOT NULL,
	"mobile_bill" numeric(12, 2) DEFAULT 0 NOT NULL,
	"food_bill" numeric(12, 2) DEFAULT 0 NOT NULL,
	"loan" numeric(12, 2) DEFAULT 0 NOT NULL,
	"advance_salary" numeric(12, 2) DEFAULT 0 NOT NULL,
	"cause" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_deductions_period_ck" CHECK ("salary_deductions"."pay_year" between 2000 and 2100 and "salary_deductions"."pay_month" between 1 and 12),
	CONSTRAINT "salary_deductions_amounts_ck" CHECK ("salary_deductions"."lwp_days" between 0 and 31 and "salary_deductions"."other_deduction" >= 0 and "salary_deductions"."ait" >= 0 and "salary_deductions"."sm" >= 0
        and "salary_deductions"."mobile_bill" >= 0 and "salary_deductions"."food_bill" >= 0 and "salary_deductions"."loan" >= 0 and "salary_deductions"."advance_salary" >= 0),
	CONSTRAINT "salary_deductions_lwp_dates_ck" CHECK ("salary_deductions"."lwp_days" = 0 or ("salary_deductions"."lwp_from" is not null and "salary_deductions"."lwp_to" is not null and "salary_deductions"."lwp_to" >= "salary_deductions"."lwp_from")),
	CONSTRAINT "salary_deductions_cause_len_ck" CHECK (char_length("salary_deductions"."cause") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "salary_overtimes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"work_year" smallint NOT NULL,
	"work_month" smallint NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"hours" integer DEFAULT 0 NOT NULL,
	"amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_overtimes_period_ck" CHECK ("salary_overtimes"."pay_year" between 2000 and 2100 and "salary_overtimes"."pay_month" between 1 and 12),
	CONSTRAINT "salary_overtimes_work_ck" CHECK ("salary_overtimes"."work_year" between 2000 and 2100 and "salary_overtimes"."work_month" between 1 and 12),
	CONSTRAINT "salary_overtimes_amounts_ck" CHECK ("salary_overtimes"."days" between 0 and 31 and "salary_overtimes"."hours" between 0 and 744 and "salary_overtimes"."amount" >= 0
        and ("salary_overtimes"."hours" > 0 or "salary_overtimes"."amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "salary_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"paid_on" date,
	"advance_paid" numeric(12, 2) DEFAULT 0 NOT NULL,
	"salary_paid" numeric(12, 2) DEFAULT 0 NOT NULL,
	"payment_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_payments_period_ck" CHECK ("salary_payments"."pay_year" between 2000 and 2100 and "salary_payments"."pay_month" between 1 and 12),
	CONSTRAINT "salary_payments_amounts_ck" CHECK ("salary_payments"."advance_paid" >= 0 and "salary_payments"."salary_paid" >= 0),
	CONSTRAINT "salary_payments_mode_len_ck" CHECK (char_length("salary_payments"."payment_mode") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "salary_punishments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_punishments_period_ck" CHECK ("salary_punishments"."pay_year" between 2000 and 2100 and "salary_punishments"."pay_month" between 1 and 12),
	CONSTRAINT "salary_punishments_amount_ck" CHECK ("salary_punishments"."amount" > 0),
	CONSTRAINT "salary_punishments_description_len_ck" CHECK (char_length("salary_punishments"."description") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "salary_sheet_lines" (
	"sheet_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"department" text NOT NULL,
	"designation" text NOT NULL,
	"joining_date" date NOT NULL,
	"payment_mode" text,
	"bank_account_no" text,
	"basic" numeric(12, 2) NOT NULL,
	"house_rent" numeric(12, 2) NOT NULL,
	"medical" numeric(12, 2) NOT NULL,
	"conveyance" numeric(12, 2) NOT NULL,
	"other_allowance" numeric(12, 2) NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"allowance" numeric(12, 2) NOT NULL,
	"special_allowance" numeric(12, 2) NOT NULL,
	"overtime" numeric(12, 2) NOT NULL,
	"festival_bonus" numeric(12, 2) NOT NULL,
	"arrear" numeric(12, 2) NOT NULL,
	"total_payable" numeric(12, 2) NOT NULL,
	"pf" numeric(12, 2) NOT NULL,
	"income_tax" numeric(12, 2) NOT NULL,
	"lwp_days" numeric(5, 2) NOT NULL,
	"lwp" numeric(12, 2) NOT NULL,
	"punishment" numeric(12, 2) NOT NULL,
	"total_deduction" numeric(12, 2) NOT NULL,
	"net_payable" numeric(12, 2) NOT NULL,
	"advance" numeric(12, 2) NOT NULL,
	"paid" numeric(12, 2) NOT NULL,
	CONSTRAINT "salary_sheet_lines_sheet_id_staff_id_pk" PRIMARY KEY("sheet_id","staff_id"),
	CONSTRAINT "salary_sheet_lines_net_ck" CHECK ("salary_sheet_lines"."net_payable" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_sheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"status" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone NOT NULL,
	"committed_by" uuid,
	"committed_at" timestamp with time zone,
	CONSTRAINT "salary_sheets_period_ck" CHECK ("salary_sheets"."year" between 2000 and 2100 and "salary_sheets"."month" between 1 and 12),
	CONSTRAINT "salary_sheets_status_ck" CHECK ("salary_sheets"."status" in ('approved', 'committed'))
);
--> statement-breakpoint
CREATE TABLE "salary_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"stop_year" smallint NOT NULL,
	"stop_month" smallint NOT NULL,
	"start_year" smallint,
	"start_month" smallint,
	"stopped_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_stops_stop_ck" CHECK ("salary_stops"."stop_year" between 2000 and 2100 and "salary_stops"."stop_month" between 1 and 12),
	CONSTRAINT "salary_stops_start_ck" CHECK (("salary_stops"."start_year" is null and "salary_stops"."start_month" is null) or ("salary_stops"."start_month" between 1 and 12
        and "salary_stops"."start_year" * 12 + "salary_stops"."start_month" >= "salary_stops"."stop_year" * 12 + "salary_stops"."stop_month")),
	CONSTRAINT "salary_stops_amount_ck" CHECK ("salary_stops"."stopped_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "allowance_payments" ADD CONSTRAINT "allowance_payments_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_arrears" ADD CONSTRAINT "salary_arrears_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_deductions" ADD CONSTRAINT "salary_deductions_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_overtimes" ADD CONSTRAINT "salary_overtimes_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_punishments" ADD CONSTRAINT "salary_punishments_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_sheet_lines" ADD CONSTRAINT "salary_sheet_lines_sheet_id_salary_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."salary_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_sheet_lines" ADD CONSTRAINT "salary_sheet_lines_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_sheets" ADD CONSTRAINT "salary_sheets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_sheets" ADD CONSTRAINT "salary_sheets_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_stops" ADD CONSTRAINT "salary_stops_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allowance_payments_period_idx" ON "allowance_payments" USING btree ("pay_year","pay_month","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_arrears_staff_period_uq" ON "salary_arrears" USING btree ("staff_id","pay_year","pay_month");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_deductions_staff_period_uq" ON "salary_deductions" USING btree ("staff_id","pay_year","pay_month");--> statement-breakpoint
CREATE INDEX "salary_overtimes_period_idx" ON "salary_overtimes" USING btree ("pay_year","pay_month","staff_id");--> statement-breakpoint
CREATE INDEX "salary_payments_period_idx" ON "salary_payments" USING btree ("pay_year","pay_month","staff_id");--> statement-breakpoint
CREATE INDEX "salary_punishments_period_idx" ON "salary_punishments" USING btree ("pay_year","pay_month","staff_id");--> statement-breakpoint
CREATE INDEX "salary_sheet_lines_staff_idx" ON "salary_sheet_lines" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_sheets_period_uq" ON "salary_sheets" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "salary_stops_staff_idx" ON "salary_stops" USING btree ("staff_id");