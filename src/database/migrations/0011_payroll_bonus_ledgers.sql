CREATE TABLE "festival_bonus_lines" (
	"bonus_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"department" text NOT NULL,
	"designation" text NOT NULL,
	"joining_date" date NOT NULL,
	"payment_mode" text,
	"bank_account_no" text,
	"gross" numeric(12, 2) NOT NULL,
	"basic" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "festival_bonus_lines_bonus_id_staff_id_pk" PRIMARY KEY("bonus_id","staff_id"),
	CONSTRAINT "festival_bonus_lines_amount_ck" CHECK ("festival_bonus_lines"."amount" >= 0),
	CONSTRAINT "festival_bonus_lines_status_ck" CHECK ("festival_bonus_lines"."status" in ('approved', 'committed'))
);
--> statement-breakpoint
CREATE TABLE "festival_bonuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"festival_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"percent_of_basic" numeric(5, 2) NOT NULL,
	"joined_by" date NOT NULL,
	"pay_with_salary" boolean DEFAULT false NOT NULL,
	"date_from" date,
	"date_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "festival_bonuses_period_ck" CHECK ("festival_bonuses"."pay_year" between 2000 and 2100 and "festival_bonuses"."pay_month" between 1 and 12),
	CONSTRAINT "festival_bonuses_percent_ck" CHECK ("festival_bonuses"."percent_of_basic" > 0 and "festival_bonuses"."percent_of_basic" <= 100),
	CONSTRAINT "festival_bonuses_dates_ck" CHECK ("festival_bonuses"."date_to" is null or "festival_bonuses"."date_from" is null or "festival_bonuses"."date_to" >= "festival_bonuses"."date_from")
);
--> statement-breakpoint
CREATE TABLE "leave_encashments" (
	"staff_id" uuid NOT NULL,
	"pay_year" smallint NOT NULL,
	"pay_month" smallint NOT NULL,
	"leave_year" smallint NOT NULL,
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"department" text NOT NULL,
	"designation" text NOT NULL,
	"joining_date" date NOT NULL,
	"payment_mode" text,
	"gross" numeric(12, 2) NOT NULL,
	"entitled_days" numeric(5, 2) NOT NULL,
	"taken_days" integer NOT NULL,
	"remaining_days" numeric(5, 2) NOT NULL,
	"per_day" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_encashments_staff_id_pay_year_pay_month_pk" PRIMARY KEY("staff_id","pay_year","pay_month"),
	CONSTRAINT "leave_encashments_period_ck" CHECK ("leave_encashments"."pay_year" between 2000 and 2100 and "leave_encashments"."pay_month" between 1 and 12),
	CONSTRAINT "leave_encashments_amount_ck" CHECK ("leave_encashments"."amount" > 0 and "leave_encashments"."remaining_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "pf_ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"type" text NOT NULL,
	"credit" numeric(12, 2) DEFAULT 0 NOT NULL,
	"debit" numeric(12, 2) DEFAULT 0 NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pf_ledger_entries_type_ck" CHECK ("pf_ledger_entries"."type" in ('opening', 'contribution', 'interest', 'withdrawal', 'settlement', 'adjustment')),
	CONSTRAINT "pf_ledger_entries_amount_ck" CHECK ("pf_ledger_entries"."credit" >= 0 and "pf_ledger_entries"."debit" >= 0 and ("pf_ledger_entries"."credit" > 0) <> ("pf_ledger_entries"."debit" > 0))
);
--> statement-breakpoint
CREATE TABLE "staff_dues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_unit_id" uuid,
	"entry_date" date NOT NULL,
	"particulars" text NOT NULL,
	"debit" numeric(12, 2) DEFAULT 0 NOT NULL,
	"credit" numeric(12, 2) DEFAULT 0 NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_dues_particulars_len_ck" CHECK (char_length("staff_dues"."particulars") between 1 and 300),
	CONSTRAINT "staff_dues_amount_ck" CHECK ("staff_dues"."debit" >= 0 and "staff_dues"."credit" >= 0 and ("staff_dues"."debit" > 0) <> ("staff_dues"."credit" > 0))
);
--> statement-breakpoint
ALTER TABLE "festival_bonus_lines" ADD CONSTRAINT "festival_bonus_lines_bonus_id_festival_bonuses_id_fk" FOREIGN KEY ("bonus_id") REFERENCES "public"."festival_bonuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "festival_bonus_lines" ADD CONSTRAINT "festival_bonus_lines_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "festival_bonus_lines" ADD CONSTRAINT "festival_bonus_lines_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "festival_bonuses" ADD CONSTRAINT "festival_bonuses_festival_id_festivals_id_fk" FOREIGN KEY ("festival_id") REFERENCES "public"."festivals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pf_ledger_entries" ADD CONSTRAINT "pf_ledger_entries_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_dues" ADD CONSTRAINT "staff_dues_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_dues" ADD CONSTRAINT "staff_dues_service_unit_id_service_units_id_fk" FOREIGN KEY ("service_unit_id") REFERENCES "public"."service_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "festival_bonus_lines_staff_idx" ON "festival_bonus_lines" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "festival_bonuses_festival_period_uq" ON "festival_bonuses" USING btree ("festival_id","pay_year","pay_month");--> statement-breakpoint
CREATE INDEX "pf_ledger_entries_staff_idx" ON "pf_ledger_entries" USING btree ("staff_id","entry_date");--> statement-breakpoint
CREATE INDEX "staff_dues_staff_idx" ON "staff_dues" USING btree ("staff_id","entry_date");