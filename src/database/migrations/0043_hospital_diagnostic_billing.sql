CREATE TABLE "hospital_diagnostic_bill_lines" (
	"bill_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"test_id" uuid NOT NULL,
	"package_id" uuid,
	"rate" numeric(12, 2) NOT NULL,
	"discount_allowed" boolean NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"referral_percent" numeric(5, 2) NOT NULL,
	"referral_amount" numeric(12, 2) NOT NULL,
	"report_due_at" timestamp with time zone,
	"status" text NOT NULL,
	"cancelled_on" date,
	"cancel_reason" text,
	CONSTRAINT "hospital_diagnostic_bill_lines_bill_id_position_pk" PRIMARY KEY("bill_id","position"),
	CONSTRAINT "hospital_diagnostic_bill_lines_amounts_ck" CHECK ("hospital_diagnostic_bill_lines"."rate" >= 0 and "hospital_diagnostic_bill_lines"."discount" between 0 and "hospital_diagnostic_bill_lines"."rate" and "hospital_diagnostic_bill_lines"."referral_amount" between 0 and "hospital_diagnostic_bill_lines"."rate")
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"billed_on" date NOT NULL,
	"billed_at" timestamp with time zone NOT NULL,
	"referred_by_id" uuid,
	"corporate_client_id" uuid,
	"staff_id" uuid,
	"gross" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"discount_reason" text,
	"net" numeric(12, 2) NOT NULL,
	"cancelled" numeric(12, 2) DEFAULT 0 NOT NULL,
	"paid" numeric(12, 2) NOT NULL,
	"collected" numeric(12, 2) DEFAULT 0 NOT NULL,
	"refunded" numeric(12, 2) DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"voucher_number" text,
	"billed_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_diagnostic_bills_payer_ck" CHECK ("hospital_diagnostic_bills"."corporate_client_id" is null or "hospital_diagnostic_bills"."staff_id" is null),
	CONSTRAINT "hospital_diagnostic_bills_amounts_ck" CHECK ("hospital_diagnostic_bills"."discount" >= 0 and "hospital_diagnostic_bills"."discount" <= "hospital_diagnostic_bills"."gross" and "hospital_diagnostic_bills"."net" = "hospital_diagnostic_bills"."gross" - "hospital_diagnostic_bills"."discount" and "hospital_diagnostic_bills"."cancelled" between 0 and "hospital_diagnostic_bills"."net" and "hospital_diagnostic_bills"."paid" >= 0 and "hospital_diagnostic_bills"."collected" >= 0 and "hospital_diagnostic_bills"."refunded" >= 0 and "hospital_diagnostic_bills"."paid" + "hospital_diagnostic_bills"."collected" - "hospital_diagnostic_bills"."refunded" <= "hospital_diagnostic_bills"."net" - "hospital_diagnostic_bills"."cancelled")
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_diagnostic_departments_name_ck" CHECK (char_length("hospital_diagnostic_departments"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_package_tests" (
	"package_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	CONSTRAINT "hospital_diagnostic_package_tests_package_id_test_id_pk" PRIMARY KEY("package_id","test_id"),
	CONSTRAINT "hospital_diagnostic_package_tests_rate_ck" CHECK ("hospital_diagnostic_package_tests"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_diagnostic_packages_name_ck" CHECK (char_length("hospital_diagnostic_packages"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bill_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text,
	"method" text NOT NULL,
	"reference" text,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"received_by" uuid,
	"voucher_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_diagnostic_payments_amount_ck" CHECK ("hospital_diagnostic_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_policy" (
	"id" smallint PRIMARY KEY NOT NULL,
	"counter_discount_percent" numeric(5, 2) NOT NULL,
	"default_referral_percent" numeric(5, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "hospital_diagnostic_policy_single_ck" CHECK ("hospital_diagnostic_policy"."id" = 1),
	CONSTRAINT "hospital_diagnostic_policy_percent_ck" CHECK ("hospital_diagnostic_policy"."counter_discount_percent" between 0 and 100 and "hospital_diagnostic_policy"."default_referral_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_diagnostic_tests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"short_name" text,
	"department_id" uuid NOT NULL,
	"specimen" text,
	"room_no" text,
	"rate" numeric(12, 2) NOT NULL,
	"report_hours" smallint,
	"discount_allowed" boolean DEFAULT true NOT NULL,
	"referral_percent" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_diagnostic_tests_name_ck" CHECK (char_length("hospital_diagnostic_tests"."name") between 1 and 150),
	CONSTRAINT "hospital_diagnostic_tests_rate_ck" CHECK ("hospital_diagnostic_tests"."rate" >= 0),
	CONSTRAINT "hospital_diagnostic_tests_hours_ck" CHECK ("hospital_diagnostic_tests"."report_hours" is null or "hospital_diagnostic_tests"."report_hours" between 0 and 2000),
	CONSTRAINT "hospital_diagnostic_tests_referral_ck" CHECK ("hospital_diagnostic_tests"."referral_percent" is null or "hospital_diagnostic_tests"."referral_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "hospital_doctor_ledger" ADD COLUMN "diagnostic_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_doctors" ADD COLUMN "referral_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bill_lines" ADD CONSTRAINT "hospital_diagnostic_bill_lines_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bill_lines" ADD CONSTRAINT "hospital_diagnostic_bill_lines_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bill_lines" ADD CONSTRAINT "hospital_diagnostic_bill_lines_package_id_hospital_diagnostic_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."hospital_diagnostic_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_referred_by_id_hospital_doctors_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_bills" ADD CONSTRAINT "hospital_diagnostic_bills_billed_by_users_id_fk" FOREIGN KEY ("billed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_package_tests" ADD CONSTRAINT "hospital_diagnostic_package_tests_package_id_hospital_diagnostic_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."hospital_diagnostic_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_package_tests" ADD CONSTRAINT "hospital_diagnostic_package_tests_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_payments" ADD CONSTRAINT "hospital_diagnostic_payments_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_payments" ADD CONSTRAINT "hospital_diagnostic_payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_policy" ADD CONSTRAINT "hospital_diagnostic_policy_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_tests" ADD CONSTRAINT "hospital_diagnostic_tests_department_id_hospital_diagnostic_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hospital_diagnostic_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_bill_lines_test_idx" ON "hospital_diagnostic_bill_lines" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_diagnostic_bills_number_uq" ON "hospital_diagnostic_bills" USING btree ("number");--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_bills_patient_idx" ON "hospital_diagnostic_bills" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_bills_billed_idx" ON "hospital_diagnostic_bills" USING btree ("billed_on");--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_bills_corporate_idx" ON "hospital_diagnostic_bills" USING btree ("corporate_client_id");--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_bills_referrer_idx" ON "hospital_diagnostic_bills" USING btree ("referred_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_diagnostic_departments_name_uq" ON "hospital_diagnostic_departments" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_diagnostic_packages_name_uq" ON "hospital_diagnostic_packages" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_payments_bill_idx" ON "hospital_diagnostic_payments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "hospital_diagnostic_payments_paid_idx" ON "hospital_diagnostic_payments" USING btree ("paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_diagnostic_tests_code_uq" ON "hospital_diagnostic_tests" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_diagnostic_tests_name_uq" ON "hospital_diagnostic_tests" USING btree ("department_id",lower("name"));--> statement-breakpoint
ALTER TABLE "hospital_doctor_ledger" ADD CONSTRAINT "hospital_doctor_ledger_diagnostic_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("diagnostic_bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;