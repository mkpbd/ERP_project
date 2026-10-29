CREATE TABLE "clinical_sequences" (
	"kind" text NOT NULL,
	"year" smallint NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "clinical_sequences_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
CREATE TABLE "clinical_phrases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"doctor_id" uuid,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"short_key" text,
	"generic_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_phrases_generic_ck" CHECK ("clinical_phrases"."generic_id" is null or "clinical_phrases"."kind" = 'dose')
);
--> statement-breakpoint
CREATE TABLE "clinical_prescriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"appointment_id" uuid,
	"visit_no" smallint NOT NULL,
	"visit_on" date NOT NULL,
	"status" text NOT NULL,
	"weight_kg" numeric(5, 1),
	"height_cm" numeric(5, 1),
	"bp_systolic" smallint,
	"bp_diastolic" smallint,
	"pulse" smallint,
	"temperature_f" numeric(5, 1),
	"spo2" smallint,
	"vitals_by" uuid,
	"vitals_at" timestamp with time zone,
	"history" text,
	"past_history" text,
	"drug_history" text,
	"examination" text,
	"diagnosis" text,
	"treatment_plan" text,
	"notes" text,
	"follow_up_on" date,
	"follow_up_note" text,
	"referral" text,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"cancel_reason" text,
	"opened_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_prescriptions_follow_up_ck" CHECK ("clinical_prescriptions"."follow_up_on" is null or "clinical_prescriptions"."follow_up_on" >= "clinical_prescriptions"."visit_on")
);
--> statement-breakpoint
CREATE TABLE "clinical_rx_advices" (
	"prescription_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"advice" text NOT NULL,
	CONSTRAINT "clinical_rx_advices_prescription_id_position_pk" PRIMARY KEY("prescription_id","position")
);
--> statement-breakpoint
CREATE TABLE "clinical_rx_complaints" (
	"prescription_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"complaint" text NOT NULL,
	"duration" text,
	CONSTRAINT "clinical_rx_complaints_prescription_id_position_pk" PRIMARY KEY("prescription_id","position")
);
--> statement-breakpoint
CREATE TABLE "clinical_rx_drugs" (
	"prescription_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"dose" text NOT NULL,
	"duration" text,
	"qty" integer,
	CONSTRAINT "clinical_rx_drugs_prescription_id_position_pk" PRIMARY KEY("prescription_id","position"),
	CONSTRAINT "clinical_rx_drugs_qty_ck" CHECK ("clinical_rx_drugs"."qty" is null or "clinical_rx_drugs"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "clinical_rx_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"doctor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"diagnosis" text,
	"drugs" jsonb NOT NULL,
	"tests" jsonb NOT NULL,
	"advices" jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_rx_tests" (
	"prescription_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"test_id" uuid,
	"name" text NOT NULL,
	"note" text,
	CONSTRAINT "clinical_rx_tests_prescription_id_position_pk" PRIMARY KEY("prescription_id","position")
);
--> statement-breakpoint
ALTER TABLE "clinical_phrases" ADD CONSTRAINT "clinical_phrases_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_phrases" ADD CONSTRAINT "clinical_phrases_generic_id_pharmacy_generics_id_fk" FOREIGN KEY ("generic_id") REFERENCES "public"."pharmacy_generics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_prescriptions" ADD CONSTRAINT "clinical_prescriptions_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_prescriptions" ADD CONSTRAINT "clinical_prescriptions_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_prescriptions" ADD CONSTRAINT "clinical_prescriptions_appointment_id_hospital_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."hospital_appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_prescriptions" ADD CONSTRAINT "clinical_prescriptions_vitals_by_users_id_fk" FOREIGN KEY ("vitals_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_prescriptions" ADD CONSTRAINT "clinical_prescriptions_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_prescriptions" ADD CONSTRAINT "clinical_prescriptions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_advices" ADD CONSTRAINT "clinical_rx_advices_prescription_id_clinical_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."clinical_prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_complaints" ADD CONSTRAINT "clinical_rx_complaints_prescription_id_clinical_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."clinical_prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_drugs" ADD CONSTRAINT "clinical_rx_drugs_prescription_id_clinical_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."clinical_prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_drugs" ADD CONSTRAINT "clinical_rx_drugs_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_templates" ADD CONSTRAINT "clinical_rx_templates_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_tests" ADD CONSTRAINT "clinical_rx_tests_prescription_id_clinical_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."clinical_prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_rx_tests" ADD CONSTRAINT "clinical_rx_tests_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_phrases_text_uq" ON "clinical_phrases" USING btree (coalesce("doctor_id", '00000000-0000-0000-0000-000000000000'::uuid),"kind",coalesce("generic_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("text"));--> statement-breakpoint
CREATE INDEX "clinical_phrases_kind_idx" ON "clinical_phrases" USING btree ("kind","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_prescriptions_number_uq" ON "clinical_prescriptions" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_prescriptions_appointment_uq" ON "clinical_prescriptions" USING btree ("appointment_id") WHERE "clinical_prescriptions"."appointment_id" is not null and "clinical_prescriptions"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "clinical_prescriptions_patient_idx" ON "clinical_prescriptions" USING btree ("patient_id","visit_on");--> statement-breakpoint
CREATE INDEX "clinical_prescriptions_doctor_idx" ON "clinical_prescriptions" USING btree ("doctor_id","visit_on");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_rx_templates_name_uq" ON "clinical_rx_templates" USING btree ("doctor_id",lower("name"));