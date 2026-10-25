CREATE TABLE "department_incharges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"appointment_date" date NOT NULL,
	"appointment_remarks" text,
	"release_date" date,
	"release_remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_incharges_dates_ck" CHECK ("department_incharges"."release_date" is null or "department_incharges"."release_date" >= "department_incharges"."appointment_date")
);
--> statement-breakpoint
CREATE TABLE "designations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"joining_salary" numeric(12, 2) DEFAULT 0 NOT NULL,
	"increment_after_confirmation" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "designations_name_len_ck" CHECK (char_length("designations"."name") between 1 and 100),
	CONSTRAINT "designations_money_ck" CHECK ("designations"."joining_salary" >= 0 and "designations"."increment_after_confirmation" >= 0)
);
--> statement-breakpoint
CREATE TABLE "festivals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "festivals_name_len_ck" CHECK (char_length("festivals"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "govt_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "govt_holidays_name_len_ck" CHECK (char_length("govt_holidays"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"division_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_departments_name_len_ck" CHECK (char_length("hr_departments"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hr_divisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_divisions_name_len_ck" CHECK (char_length("hr_divisions"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hr_sub_departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_sub_departments_name_len_ck" CHECK (char_length("hr_sub_departments"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "staff_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid,
	CONSTRAINT "staff_documents_type_ck" CHECK ("staff_documents"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
	CONSTRAINT "staff_documents_size_ck" CHECK ("staff_documents"."size_bytes" = octet_length("staff_documents"."data") and "staff_documents"."size_bytes" between 1 and 5242880),
	CONSTRAINT "staff_documents_category_ck" CHECK ("staff_documents"."category" in ('general', 'incharge-appointment'))
);
--> statement-breakpoint
CREATE TABLE "staff_education" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"exam_name" text NOT NULL,
	"passing_year" smallint,
	"subject" text,
	"result" text,
	"board" text
);
--> statement-breakpoint
CREATE TABLE "staff_emergency_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"contact" text NOT NULL,
	"relation" text
);
--> statement-breakpoint
CREATE TABLE "staff_festivals" (
	"staff_id" uuid NOT NULL,
	"festival_id" uuid NOT NULL,
	CONSTRAINT "staff_festivals_pk" PRIMARY KEY("staff_id","festival_id")
);
--> statement-breakpoint
CREATE TABLE "staff_photos" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "staff_photos_type_ck" CHECK ("staff_photos"."content_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "staff_photos_size_ck" CHECK (octet_length("staff_photos"."data") between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "staff_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"employee_no" text NOT NULL,
	"full_name" text NOT NULL,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"father_name" text,
	"mother_name" text,
	"date_of_birth" date,
	"sex" text,
	"marital_status" text,
	"religion" text,
	"blood_group" text,
	"nationality_country_id" uuid,
	"nationality_other" text,
	"national_id_or_passport" text,
	"tin_no" text,
	"mobile_no" text,
	"official_mobile_no" text,
	"email" text,
	"guardian_contact" text,
	"present_address" text,
	"permanent_address" text,
	"division_id" uuid,
	"department_id" uuid NOT NULL,
	"sub_department_id" uuid NOT NULL,
	"designation_id" uuid NOT NULL,
	"joining_designation_id" uuid,
	"joining_date" date NOT NULL,
	"probation_end_date" date,
	"confirmation_date" date,
	"employee_category" smallint,
	"job_location" text,
	"service_nature" text NOT NULL,
	"salary_status" text NOT NULL,
	"payment_mode" text,
	"bank_account_no" text,
	"biometric_enrollment_no" integer,
	"is_head_of_department" boolean DEFAULT false NOT NULL,
	"working_time" text,
	"interval_time" text,
	"weekly_holiday" text,
	"shift_and_relay" text,
	"change_group_description" text,
	"nursing_council_no" text,
	"medical_council_no" text,
	"remarks" text,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"separation_date" date,
	"user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_records_status_ck" CHECK ("staff_records"."status" in ('active', 'inactive', 'separated')),
	CONSTRAINT "staff_records_separation_ck" CHECK (("staff_records"."status" = 'separated') = ("staff_records"."separation_date" is not null)),
	CONSTRAINT "staff_records_full_name_len_ck" CHECK (char_length("staff_records"."full_name") between 1 and 150),
	CONSTRAINT "staff_records_employee_no_len_ck" CHECK (char_length("staff_records"."employee_no") between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "department_incharges" ADD CONSTRAINT "department_incharges_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_incharges" ADD CONSTRAINT "department_incharges_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_division_id_hr_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."hr_divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_sub_departments" ADD CONSTRAINT "hr_sub_departments_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_education" ADD CONSTRAINT "staff_education_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_emergency_contacts" ADD CONSTRAINT "staff_emergency_contacts_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_festivals" ADD CONSTRAINT "staff_festivals_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_festivals" ADD CONSTRAINT "staff_festivals_festival_id_festivals_id_fk" FOREIGN KEY ("festival_id") REFERENCES "public"."festivals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_nationality_country_id_countries_id_fk" FOREIGN KEY ("nationality_country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_division_id_hr_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."hr_divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_sub_department_id_hr_sub_departments_id_fk" FOREIGN KEY ("sub_department_id") REFERENCES "public"."hr_sub_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_joining_designation_id_designations_id_fk" FOREIGN KEY ("joining_designation_id") REFERENCES "public"."designations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_records" ADD CONSTRAINT "staff_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "department_incharges_department_idx" ON "department_incharges" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "department_incharges_staff_idx" ON "department_incharges" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "designations_name_uq" ON "designations" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "festivals_name_uq" ON "festivals" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "govt_holidays_date_name_uq" ON "govt_holidays" USING btree ("holiday_date",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hr_departments_name_uq" ON "hr_departments" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "hr_departments_division_idx" ON "hr_departments" USING btree ("division_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_divisions_name_uq" ON "hr_divisions" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hr_sub_departments_department_name_uq" ON "hr_sub_departments" USING btree ("department_id",lower("name"));--> statement-breakpoint
CREATE INDEX "hr_sub_departments_department_idx" ON "hr_sub_departments" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "staff_documents_staff_idx" ON "staff_documents" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_education_staff_position_uq" ON "staff_education" USING btree ("staff_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_emergency_contacts_staff_position_uq" ON "staff_emergency_contacts" USING btree ("staff_id","position");--> statement-breakpoint
CREATE INDEX "staff_festivals_festival_idx" ON "staff_festivals" USING btree ("festival_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_records_employee_no_uq" ON "staff_records" USING btree (upper("employee_no"));--> statement-breakpoint
CREATE UNIQUE INDEX "staff_records_biometric_uq" ON "staff_records" USING btree ("biometric_enrollment_no");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_records_user_uq" ON "staff_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_records_department_idx" ON "staff_records" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "staff_records_designation_idx" ON "staff_records" USING btree ("designation_id");--> statement-breakpoint
CREATE INDEX "staff_records_status_idx" ON "staff_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "staff_records_joining_date_idx" ON "staff_records" USING btree ("joining_date");