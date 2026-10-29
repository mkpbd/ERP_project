CREATE TABLE "clinical_discharge_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"diagnosis" text,
	"course" text,
	"condition_on_discharge" text,
	"treatment" jsonb NOT NULL,
	"diet" text,
	"advice" text,
	"follow_up_on" date,
	"follow_up_note" text,
	"doctor_id" uuid NOT NULL,
	"status" text NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"written_by" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_dose_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"due_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"given_at" timestamp with time zone,
	"reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_dose_records_outcome_ck" CHECK (("clinical_dose_records"."outcome" = 'given') = ("clinical_dose_records"."given_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "clinical_order_events" (
	"order_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"event" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text,
	"by" uuid NOT NULL,
	CONSTRAINT "clinical_order_events_order_id_position_pk" PRIMARY KEY("order_id","position")
);
--> statement-breakpoint
CREATE TABLE "clinical_treatment_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"product_id" uuid,
	"drug_name" text NOT NULL,
	"dose" text NOT NULL,
	"route" text NOT NULL,
	"schedule" text NOT NULL,
	"times" text[] NOT NULL,
	"interval_hours" smallint,
	"start_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"doctor_id" uuid NOT NULL,
	"ordered_by" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_treatment_orders_schedule_ck" CHECK (("clinical_treatment_orders"."schedule" = 'interval') = ("clinical_treatment_orders"."interval_hours" is not null) and ("clinical_treatment_orders"."schedule" = 'times') = (cardinality("clinical_treatment_orders"."times") > 0))
);
--> statement-breakpoint
ALTER TABLE "clinical_discharge_summaries" ADD CONSTRAINT "clinical_discharge_summaries_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_discharge_summaries" ADD CONSTRAINT "clinical_discharge_summaries_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_discharge_summaries" ADD CONSTRAINT "clinical_discharge_summaries_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_discharge_summaries" ADD CONSTRAINT "clinical_discharge_summaries_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_discharge_summaries" ADD CONSTRAINT "clinical_discharge_summaries_written_by_users_id_fk" FOREIGN KEY ("written_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_dose_records" ADD CONSTRAINT "clinical_dose_records_order_id_clinical_treatment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."clinical_treatment_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_dose_records" ADD CONSTRAINT "clinical_dose_records_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_dose_records" ADD CONSTRAINT "clinical_dose_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_order_events" ADD CONSTRAINT "clinical_order_events_order_id_clinical_treatment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."clinical_treatment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_order_events" ADD CONSTRAINT "clinical_order_events_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD CONSTRAINT "clinical_treatment_orders_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD CONSTRAINT "clinical_treatment_orders_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD CONSTRAINT "clinical_treatment_orders_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD CONSTRAINT "clinical_treatment_orders_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD CONSTRAINT "clinical_treatment_orders_ordered_by_users_id_fk" FOREIGN KEY ("ordered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_discharge_summaries_admission_uq" ON "clinical_discharge_summaries" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_dose_records_due_uq" ON "clinical_dose_records" USING btree ("order_id","due_at") WHERE "clinical_dose_records"."due_at" is not null;--> statement-breakpoint
CREATE INDEX "clinical_dose_records_admission_idx" ON "clinical_dose_records" USING btree ("admission_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_treatment_orders_admission_idx" ON "clinical_treatment_orders" USING btree ("admission_id","status");