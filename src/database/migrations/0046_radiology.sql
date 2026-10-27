CREATE TABLE "lab_imaging_sequences" (
	"day" date PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_imaging_studies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"accession_number" text NOT NULL,
	"bill_id" uuid NOT NULL,
	"line" smallint NOT NULL,
	"test_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"done_on" date NOT NULL,
	"done_at" timestamp with time zone NOT NULL,
	"done_by" uuid,
	"status" text NOT NULL,
	"findings" text,
	"impression" text,
	"radiologist_id" uuid,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"reporting_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"delivered_to" text,
	"delivered_by" uuid,
	"delivered_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_imaging_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"test_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"findings" text NOT NULL,
	"impression" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_imaging_templates_name_ck" CHECK (char_length("lab_imaging_templates"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_tests" ADD COLUMN "reporting_fee_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_tests" ADD COLUMN "reporting_fee_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_radiologist_id_hospital_doctors_id_fk" FOREIGN KEY ("radiologist_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD CONSTRAINT "lab_imaging_studies_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_imaging_templates" ADD CONSTRAINT "lab_imaging_templates_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_imaging_studies_accession_uq" ON "lab_imaging_studies" USING btree ("accession_number");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_imaging_studies_line_uq" ON "lab_imaging_studies" USING btree ("bill_id","line");--> statement-breakpoint
CREATE INDEX "lab_imaging_studies_done_idx" ON "lab_imaging_studies" USING btree ("done_on","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_imaging_templates_position_uq" ON "lab_imaging_templates" USING btree ("test_id","position");--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_tests" ADD CONSTRAINT "hospital_diagnostic_tests_reporting_ck" CHECK (("hospital_diagnostic_tests"."reporting_fee_percent" is null or "hospital_diagnostic_tests"."reporting_fee_percent" between 0 and 100) and ("hospital_diagnostic_tests"."reporting_fee_amount" is null or "hospital_diagnostic_tests"."reporting_fee_amount" >= 0));