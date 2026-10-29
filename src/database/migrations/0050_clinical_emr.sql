CREATE TABLE "clinical_birth_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"admission_id" uuid NOT NULL,
	"mother_id" uuid NOT NULL,
	"child_name" text,
	"child_sex" text NOT NULL,
	"born_at" timestamp with time zone NOT NULL,
	"delivery_mode" text NOT NULL,
	"birth_weight_kg" numeric(4, 2) NOT NULL,
	"father_name" text,
	"grandfather_name" text,
	"religion" text,
	"father_present_address" text,
	"father_permanent_address" text,
	"comments" text,
	"doctor_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_birth_records_weight_ck" CHECK ("clinical_birth_records"."birth_weight_kg" > 0 and "clinical_birth_records"."birth_weight_kg" < 10)
);
--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"doctor_id" uuid,
	"noted_at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	"handed_to" uuid,
	"acknowledged_at" timestamp with time zone,
	"written_by" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_notes_handover_ck" CHECK (("clinical_notes"."kind" = 'handover') = ("clinical_notes"."handed_to" is not null))
);
--> statement-breakpoint
CREATE TABLE "clinical_death_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"died_at" timestamp with time zone NOT NULL,
	"cause" text NOT NULL,
	"antecedent_cause" text,
	"other_conditions" text,
	"deceased_nid" text,
	"guardian_name" text,
	"guardian_nid" text,
	"guardian_relation" text,
	"family_contact_no" text,
	"doctor_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_note_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinical_birth_records" ADD CONSTRAINT "clinical_birth_records_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_birth_records" ADD CONSTRAINT "clinical_birth_records_mother_id_hospital_patients_id_fk" FOREIGN KEY ("mother_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_birth_records" ADD CONSTRAINT "clinical_birth_records_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_birth_records" ADD CONSTRAINT "clinical_birth_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_handed_to_users_id_fk" FOREIGN KEY ("handed_to") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_written_by_users_id_fk" FOREIGN KEY ("written_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_death_records" ADD CONSTRAINT "clinical_death_records_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_death_records" ADD CONSTRAINT "clinical_death_records_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_death_records" ADD CONSTRAINT "clinical_death_records_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_death_records" ADD CONSTRAINT "clinical_death_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_birth_records_number_uq" ON "clinical_birth_records" USING btree ("number");--> statement-breakpoint
CREATE INDEX "clinical_birth_records_admission_idx" ON "clinical_birth_records" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "clinical_notes_admission_idx" ON "clinical_notes" USING btree ("admission_id","noted_at");--> statement-breakpoint
CREATE INDEX "clinical_notes_handover_idx" ON "clinical_notes" USING btree ("handed_to") WHERE "clinical_notes"."acknowledged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_death_records_number_uq" ON "clinical_death_records" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_death_records_admission_uq" ON "clinical_death_records" USING btree ("admission_id") WHERE "clinical_death_records"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_note_templates_name_uq" ON "clinical_note_templates" USING btree (lower("name"));