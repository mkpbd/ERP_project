CREATE TABLE "hospital_doctor_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"doctor_id" uuid NOT NULL,
	"entry_on" date NOT NULL,
	"kind" text NOT NULL,
	"bill_id" uuid,
	"document_number" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital_opd_bill_lines" (
	"bill_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"doctor_id" uuid NOT NULL,
	"visit_type" text NOT NULL,
	"fee" numeric(12, 2) NOT NULL,
	"share_percent" numeric(5, 2) NOT NULL,
	"share_amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "hospital_opd_bill_lines_bill_id_position_pk" PRIMARY KEY("bill_id","position"),
	CONSTRAINT "hospital_opd_bill_lines_amounts_ck" CHECK ("hospital_opd_bill_lines"."fee" >= 0 and "hospital_opd_bill_lines"."share_amount" >= 0 and "hospital_opd_bill_lines"."share_amount" <= "hospital_opd_bill_lines"."fee")
);
--> statement-breakpoint
CREATE TABLE "hospital_opd_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"billed_on" date NOT NULL,
	"referred_by_id" uuid,
	"gross" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"discount_reason" text,
	"net" numeric(12, 2) NOT NULL,
	"paid" numeric(12, 2) NOT NULL,
	"collected" numeric(12, 2) DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"cancelled_on" date,
	"cancelled_by" uuid,
	"refunded" numeric(12, 2) DEFAULT 0 NOT NULL,
	"voucher_number" text,
	"cancel_voucher_number" text,
	"billed_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_opd_bills_amounts_ck" CHECK ("hospital_opd_bills"."discount" >= 0 and "hospital_opd_bills"."discount" <= "hospital_opd_bills"."gross" and "hospital_opd_bills"."net" = "hospital_opd_bills"."gross" - "hospital_opd_bills"."discount" and "hospital_opd_bills"."paid" >= 0 and "hospital_opd_bills"."collected" >= 0 and "hospital_opd_bills"."paid" + "hospital_opd_bills"."collected" <= "hospital_opd_bills"."net")
);
--> statement-breakpoint
CREATE TABLE "hospital_opd_payments" (
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
	CONSTRAINT "hospital_opd_payments_amount_ck" CHECK ("hospital_opd_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_opd_policy" (
	"id" smallint PRIMARY KEY NOT NULL,
	"follow_up_days" smallint NOT NULL,
	"default_share_percent" numeric(5, 2) NOT NULL,
	"counter_discount_percent" numeric(5, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "hospital_opd_policy_single_ck" CHECK ("hospital_opd_policy"."id" = 1),
	CONSTRAINT "hospital_opd_policy_days_ck" CHECK ("hospital_opd_policy"."follow_up_days" between 0 and 365),
	CONSTRAINT "hospital_opd_policy_percent_ck" CHECK ("hospital_opd_policy"."default_share_percent" between 0 and 100 and "hospital_opd_policy"."counter_discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_uhid_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"used_on" date NOT NULL,
	"service" text NOT NULL,
	"document_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospital_appointments" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_doctors" ADD COLUMN "share_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "hospital_doctor_ledger" ADD CONSTRAINT "hospital_doctor_ledger_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctor_ledger" ADD CONSTRAINT "hospital_doctor_ledger_bill_id_hospital_opd_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_opd_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD CONSTRAINT "hospital_opd_bill_lines_bill_id_hospital_opd_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_opd_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD CONSTRAINT "hospital_opd_bill_lines_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_appointment_id_hospital_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."hospital_appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_referred_by_id_hospital_doctors_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_billed_by_users_id_fk" FOREIGN KEY ("billed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_payments" ADD CONSTRAINT "hospital_opd_payments_bill_id_hospital_opd_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_opd_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_payments" ADD CONSTRAINT "hospital_opd_payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_policy" ADD CONSTRAINT "hospital_opd_policy_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_uhid_uses" ADD CONSTRAINT "hospital_uhid_uses_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_doctor_ledger_doctor_idx" ON "hospital_doctor_ledger" USING btree ("doctor_id","entry_on");--> statement-breakpoint
CREATE INDEX "hospital_opd_bill_lines_doctor_idx" ON "hospital_opd_bill_lines" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_opd_bills_number_uq" ON "hospital_opd_bills" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_opd_bills_appointment_uq" ON "hospital_opd_bills" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "hospital_opd_bills_patient_idx" ON "hospital_opd_bills" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "hospital_opd_bills_billed_idx" ON "hospital_opd_bills" USING btree ("billed_on");--> statement-breakpoint
CREATE INDEX "hospital_opd_payments_bill_idx" ON "hospital_opd_payments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "hospital_opd_payments_paid_idx" ON "hospital_opd_payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "hospital_uhid_uses_patient_idx" ON "hospital_uhid_uses" USING btree ("patient_id","used_on");--> statement-breakpoint
ALTER TABLE "hospital_appointments" ADD CONSTRAINT "hospital_appointments_bill_id_hospital_opd_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_opd_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctors" ADD CONSTRAINT "hospital_doctors_share_ck" CHECK ("hospital_doctors"."share_percent" is null or "hospital_doctors"."share_percent" between 0 and 100);