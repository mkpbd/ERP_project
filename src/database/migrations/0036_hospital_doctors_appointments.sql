CREATE TABLE "hospital_appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"doctor_id" uuid NOT NULL,
	"appointment_date" date NOT NULL,
	"serial" smallint NOT NULL,
	"slot_time" text NOT NULL,
	"visit_type" text NOT NULL,
	"patient_id" uuid,
	"patient_name" text NOT NULL,
	"mobile_no" text NOT NULL,
	"referred_by_id" uuid,
	"fee" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"remarks" text,
	"booked_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_appointments_serial_ck" CHECK ("hospital_appointments"."serial" between 1 and 500),
	CONSTRAINT "hospital_appointments_mobile_ck" CHECK ("hospital_appointments"."mobile_no" ~ '^01[3-9][0-9]{8}$'),
	CONSTRAINT "hospital_appointments_fee_ck" CHECK ("hospital_appointments"."fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_doctor_closures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"doctor_id" uuid NOT NULL,
	"closed_on" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hospital_doctor_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"doctor_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" text NOT NULL,
	"slot_minutes" smallint NOT NULL,
	"max_patients" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_doctor_schedules_day_ck" CHECK ("hospital_doctor_schedules"."day_of_week" between 0 and 6),
	CONSTRAINT "hospital_doctor_schedules_time_ck" CHECK ("hospital_doctor_schedules"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "hospital_doctor_schedules_slot_ck" CHECK ("hospital_doctor_schedules"."slot_minutes" between 1 and 240),
	CONSTRAINT "hospital_doctor_schedules_max_ck" CHECK ("hospital_doctor_schedules"."max_patients" between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "hospital_doctors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"degrees" text,
	"speciality_id" uuid,
	"phone" text,
	"room_no" text,
	"is_consultant" boolean DEFAULT false NOT NULL,
	"first_visit_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"new_visit_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"follow_up_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"report_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_doctors_name_ck" CHECK (char_length("hospital_doctors"."name") between 1 and 150),
	CONSTRAINT "hospital_doctors_fees_ck" CHECK ("hospital_doctors"."first_visit_fee" >= 0 and "hospital_doctors"."new_visit_fee" >= 0 and "hospital_doctors"."follow_up_fee" >= 0 and "hospital_doctors"."report_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_specialities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_specialities_name_ck" CHECK (char_length("hospital_specialities"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "hospital_appointments" ADD CONSTRAINT "hospital_appointments_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_appointments" ADD CONSTRAINT "hospital_appointments_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_appointments" ADD CONSTRAINT "hospital_appointments_referred_by_id_hospital_doctors_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_appointments" ADD CONSTRAINT "hospital_appointments_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctor_closures" ADD CONSTRAINT "hospital_doctor_closures_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctor_schedules" ADD CONSTRAINT "hospital_doctor_schedules_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctors" ADD CONSTRAINT "hospital_doctors_speciality_id_hospital_specialities_id_fk" FOREIGN KEY ("speciality_id") REFERENCES "public"."hospital_specialities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_doctors" ADD CONSTRAINT "hospital_doctors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_appointments_serial_uq" ON "hospital_appointments" USING btree ("doctor_id","appointment_date","serial") WHERE "hospital_appointments"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "hospital_appointments_date_idx" ON "hospital_appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX "hospital_appointments_patient_idx" ON "hospital_appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_doctor_closures_day_uq" ON "hospital_doctor_closures" USING btree ("doctor_id","closed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_doctor_schedules_day_uq" ON "hospital_doctor_schedules" USING btree ("doctor_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_doctors_code_uq" ON "hospital_doctors" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_doctors_user_uq" ON "hospital_doctors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hospital_doctors_name_idx" ON "hospital_doctors" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_specialities_name_uq" ON "hospital_specialities" USING btree (lower("name"));