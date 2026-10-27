CREATE TABLE "hospital_ipd_bill_lines" (
	"bill_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"head" text NOT NULL,
	"description" text NOT NULL,
	"bed_id" uuid,
	"charge_id" uuid,
	"service_id" uuid,
	"doctor_id" uuid,
	"from_on" date,
	"to_on" date,
	"qty" smallint NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"service_charge" numeric(12, 2) NOT NULL,
	"share_amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "hospital_ipd_bill_lines_bill_id_position_pk" PRIMARY KEY("bill_id","position"),
	CONSTRAINT "hospital_ipd_bill_lines_amounts_ck" CHECK ("hospital_ipd_bill_lines"."qty" >= 0 and "hospital_ipd_bill_lines"."rate" >= 0 and "hospital_ipd_bill_lines"."amount" >= 0 and "hospital_ipd_bill_lines"."service_charge" >= 0 and "hospital_ipd_bill_lines"."share_amount" >= 0 and "hospital_ipd_bill_lines"."share_amount" <= "hospital_ipd_bill_lines"."amount")
);
--> statement-breakpoint
CREATE TABLE "hospital_ipd_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"billed_on" date NOT NULL,
	"corporate_client_id" uuid,
	"staff_id" uuid,
	"nights" smallint NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"service_charge" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"discount_reason" text,
	"net" numeric(12, 2) NOT NULL,
	"deposit" numeric(12, 2) NOT NULL,
	"paid" numeric(12, 2) NOT NULL,
	"collected" numeric(12, 2) DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"cancelled_on" date,
	"cancelled_by" uuid,
	"voucher_number" text,
	"cancel_voucher_number" text,
	"billed_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_ipd_bills_payer_ck" CHECK ("hospital_ipd_bills"."corporate_client_id" is null or "hospital_ipd_bills"."staff_id" is null),
	CONSTRAINT "hospital_ipd_bills_amounts_ck" CHECK ("hospital_ipd_bills"."discount" >= 0 and "hospital_ipd_bills"."discount" <= "hospital_ipd_bills"."gross" + "hospital_ipd_bills"."service_charge" and "hospital_ipd_bills"."net" = "hospital_ipd_bills"."gross" + "hospital_ipd_bills"."service_charge" - "hospital_ipd_bills"."discount" and "hospital_ipd_bills"."deposit" >= 0 and "hospital_ipd_bills"."paid" >= 0 and "hospital_ipd_bills"."collected" >= 0 and "hospital_ipd_bills"."deposit" + "hospital_ipd_bills"."paid" + "hospital_ipd_bills"."collected" <= "hospital_ipd_bills"."net")
);
--> statement-breakpoint
CREATE TABLE "hospital_ipd_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"doctor_id" uuid,
	"charged_on" date NOT NULL,
	"qty" smallint NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"share_percent" numeric(5, 2) NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"charged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_ipd_charges_amounts_ck" CHECK ("hospital_ipd_charges"."qty" between 1 and 1000 and "hospital_ipd_charges"."rate" >= 0 and "hospital_ipd_charges"."amount" = round("hospital_ipd_charges"."qty" * "hospital_ipd_charges"."rate", 2) and "hospital_ipd_charges"."share_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_ipd_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"bill_id" uuid,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"received_by" uuid,
	"voucher_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_ipd_payments_amount_ck" CHECK ("hospital_ipd_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_ipd_policy" (
	"id" smallint PRIMARY KEY NOT NULL,
	"round_fee_per_night" numeric(12, 2) NOT NULL,
	"service_charge_percent" numeric(5, 2) NOT NULL,
	"counter_discount_percent" numeric(5, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "hospital_ipd_policy_single_ck" CHECK ("hospital_ipd_policy"."id" = 1),
	CONSTRAINT "hospital_ipd_policy_amounts_ck" CHECK ("hospital_ipd_policy"."round_fee_per_night" >= 0 and "hospital_ipd_policy"."service_charge_percent" between 0 and 100 and "hospital_ipd_policy"."counter_discount_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "hospital_doctor_ledger" ADD COLUMN "ipd_bill_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bill_lines" ADD CONSTRAINT "hospital_ipd_bill_lines_bill_id_hospital_ipd_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_ipd_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bill_lines" ADD CONSTRAINT "hospital_ipd_bill_lines_bed_id_hospital_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "public"."hospital_beds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bill_lines" ADD CONSTRAINT "hospital_ipd_bill_lines_charge_id_hospital_ipd_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."hospital_ipd_charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bill_lines" ADD CONSTRAINT "hospital_ipd_bill_lines_service_id_hospital_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."hospital_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bill_lines" ADD CONSTRAINT "hospital_ipd_bill_lines_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bills" ADD CONSTRAINT "hospital_ipd_bills_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bills" ADD CONSTRAINT "hospital_ipd_bills_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bills" ADD CONSTRAINT "hospital_ipd_bills_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bills" ADD CONSTRAINT "hospital_ipd_bills_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bills" ADD CONSTRAINT "hospital_ipd_bills_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_bills" ADD CONSTRAINT "hospital_ipd_bills_billed_by_users_id_fk" FOREIGN KEY ("billed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD CONSTRAINT "hospital_ipd_charges_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD CONSTRAINT "hospital_ipd_charges_service_id_hospital_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."hospital_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD CONSTRAINT "hospital_ipd_charges_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD CONSTRAINT "hospital_ipd_charges_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD CONSTRAINT "hospital_ipd_charges_charged_by_users_id_fk" FOREIGN KEY ("charged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_payments" ADD CONSTRAINT "hospital_ipd_payments_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_payments" ADD CONSTRAINT "hospital_ipd_payments_bill_id_hospital_ipd_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_ipd_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_payments" ADD CONSTRAINT "hospital_ipd_payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ipd_policy" ADD CONSTRAINT "hospital_ipd_policy_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_ipd_bill_lines_doctor_idx" ON "hospital_ipd_bill_lines" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_ipd_bills_number_uq" ON "hospital_ipd_bills" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_ipd_bills_admission_uq" ON "hospital_ipd_bills" USING btree ("admission_id") WHERE "hospital_ipd_bills"."status" = 'billed';--> statement-breakpoint
CREATE INDEX "hospital_ipd_bills_patient_idx" ON "hospital_ipd_bills" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "hospital_ipd_bills_billed_idx" ON "hospital_ipd_bills" USING btree ("billed_on");--> statement-breakpoint
CREATE INDEX "hospital_ipd_bills_corporate_idx" ON "hospital_ipd_bills" USING btree ("corporate_client_id");--> statement-breakpoint
CREATE INDEX "hospital_ipd_charges_admission_idx" ON "hospital_ipd_charges" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "hospital_ipd_charges_doctor_idx" ON "hospital_ipd_charges" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_ipd_payments_number_uq" ON "hospital_ipd_payments" USING btree ("number");--> statement-breakpoint
CREATE INDEX "hospital_ipd_payments_admission_idx" ON "hospital_ipd_payments" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "hospital_ipd_payments_paid_idx" ON "hospital_ipd_payments" USING btree ("paid_on");--> statement-breakpoint
ALTER TABLE "hospital_doctor_ledger" ADD CONSTRAINT "hospital_doctor_ledger_ipd_bill_id_hospital_ipd_bills_id_fk" FOREIGN KEY ("ipd_bill_id") REFERENCES "public"."hospital_ipd_bills"("id") ON DELETE restrict ON UPDATE no action;