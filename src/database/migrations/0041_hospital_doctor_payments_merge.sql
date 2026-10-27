CREATE TABLE "hospital_doctor_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"doctor_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"voucher_number" text,
	"paid_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_doctor_payments_amount_ck" CHECK ("hospital_doctor_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_doctor_payments" ADD CONSTRAINT "hospital_doctor_payments_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctor_payments" ADD CONSTRAINT "hospital_doctor_payments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_doctor_payments_number_uq" ON "hospital_doctor_payments" USING btree ("number");--> statement-breakpoint
CREATE INDEX "hospital_doctor_payments_doctor_idx" ON "hospital_doctor_payments" USING btree ("doctor_id","paid_on");--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_merged_into_id_hospital_patients_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;