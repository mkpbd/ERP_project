CREATE TABLE "hospital_anaesthesia_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_anaesthesia_types_name_ck" CHECK (char_length("hospital_anaesthesia_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_operations_name_ck" CHECK (char_length("hospital_operations"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "hospital_ot_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"ot_type_id" uuid,
	"anaesthesia_type_id" uuid,
	"surgeon_id" uuid NOT NULL,
	"anaesthetist_id" uuid,
	"indication" text,
	"requested_for" date NOT NULL,
	"status" text NOT NULL,
	"ot_room_id" uuid,
	"scheduled_from" timestamp with time zone,
	"scheduled_to" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"cancel_reason" text,
	"incision" text,
	"findings" text,
	"procedure_done" text,
	"specimen" text,
	"post_op_orders" text,
	"note_signed_at" timestamp with time zone,
	"note_signed_by" uuid,
	"requested_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_ot_cases_status_ck" CHECK ("hospital_ot_cases"."status" in ('requested', 'scheduled', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "hospital_ot_cases_slot_ck" CHECK (("hospital_ot_cases"."ot_room_id" is null) = ("hospital_ot_cases"."scheduled_from" is null) and ("hospital_ot_cases"."scheduled_from" is null) = ("hospital_ot_cases"."scheduled_to" is null)
        and ("hospital_ot_cases"."scheduled_to" is null or "hospital_ot_cases"."scheduled_to" > "hospital_ot_cases"."scheduled_from")
        and ("hospital_ot_cases"."status" not in ('scheduled', 'in_progress', 'done') or "hospital_ot_cases"."ot_room_id" is not null)),
	CONSTRAINT "hospital_ot_cases_times_ck" CHECK (("hospital_ot_cases"."status" in ('in_progress', 'done')) = ("hospital_ot_cases"."started_at" is not null)
        and ("hospital_ot_cases"."status" = 'done') = ("hospital_ot_cases"."ended_at" is not null) and ("hospital_ot_cases"."ended_at" is null or "hospital_ot_cases"."ended_at" >= "hospital_ot_cases"."started_at")),
	CONSTRAINT "hospital_ot_cases_cancel_ck" CHECK (("hospital_ot_cases"."status" = 'cancelled') = ("hospital_ot_cases"."cancel_reason" is not null)),
	CONSTRAINT "hospital_ot_cases_signed_ck" CHECK ("hospital_ot_cases"."note_signed_at" is null or "hospital_ot_cases"."status" = 'done')
);
--> statement-breakpoint
CREATE TABLE "hospital_ot_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"floor" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_ot_rooms_name_ck" CHECK (char_length("hospital_ot_rooms"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_ot_team" (
	"case_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "hospital_ot_team_case_id_doctor_id_pk" PRIMARY KEY("case_id","doctor_id"),
	CONSTRAINT "hospital_ot_team_role_ck" CHECK ("hospital_ot_team"."role" in ('assistant', 'anaesthesia_assistant'))
);
--> statement-breakpoint
CREATE TABLE "hospital_ot_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_ot_types_name_ck" CHECK (char_length("hospital_ot_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_surgery_procedures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"area" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_surgery_procedures_title_ck" CHECK (char_length("hospital_surgery_procedures"."title") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD COLUMN "ot_case_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_operation_id_hospital_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."hospital_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_ot_type_id_hospital_ot_types_id_fk" FOREIGN KEY ("ot_type_id") REFERENCES "public"."hospital_ot_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_anaesthesia_type_id_hospital_anaesthesia_types_id_fk" FOREIGN KEY ("anaesthesia_type_id") REFERENCES "public"."hospital_anaesthesia_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_surgeon_id_hospital_doctors_id_fk" FOREIGN KEY ("surgeon_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_anaesthetist_id_hospital_doctors_id_fk" FOREIGN KEY ("anaesthetist_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_ot_room_id_hospital_ot_rooms_id_fk" FOREIGN KEY ("ot_room_id") REFERENCES "public"."hospital_ot_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_note_signed_by_users_id_fk" FOREIGN KEY ("note_signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_cases" ADD CONSTRAINT "hospital_ot_cases_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_team" ADD CONSTRAINT "hospital_ot_team_case_id_hospital_ot_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."hospital_ot_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_ot_team" ADD CONSTRAINT "hospital_ot_team_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_anaesthesia_types_name_uq" ON "hospital_anaesthesia_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_operations_name_uq" ON "hospital_operations" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_ot_cases_number_uq" ON "hospital_ot_cases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "hospital_ot_cases_admission_idx" ON "hospital_ot_cases" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "hospital_ot_cases_room_idx" ON "hospital_ot_cases" USING btree ("ot_room_id","scheduled_from");--> statement-breakpoint
CREATE INDEX "hospital_ot_cases_status_idx" ON "hospital_ot_cases" USING btree ("status","requested_for");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_ot_rooms_name_uq" ON "hospital_ot_rooms" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_ot_types_name_uq" ON "hospital_ot_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_surgery_procedures_title_uq" ON "hospital_surgery_procedures" USING btree (lower("title"));--> statement-breakpoint
ALTER TABLE "hospital_ipd_charges" ADD CONSTRAINT "hospital_ipd_charges_ot_case_id_hospital_ot_cases_id_fk" FOREIGN KEY ("ot_case_id") REFERENCES "public"."hospital_ot_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_ipd_charges_ot_case_idx" ON "hospital_ipd_charges" USING btree ("ot_case_id");